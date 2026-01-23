import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BlocklistService } from '../blocklist/blocklist.service';
import { ConversationsService } from '../conversations/conversations.service';
import { RateLimitingService } from '../rate-limiting/rate-limiting.service';
import { LineReputationService } from '../line-reputation/line-reputation.service';
import { AppLoggerService } from '../logger/logger.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';
import { HumanizationService } from '../humanization/humanization.service';
import { MessageSendingService } from '../message-sending/message-sending.service';
import { SpintaxService } from '../spintax/spintax.service';
import axios from 'axios';

interface TemplateVariable {
  key: string;
  value: string;
}

@Injectable()
@Processor('campaigns')
export class CampaignsProcessor {
  constructor(
    private prisma: PrismaService,
    private blocklistService: BlocklistService,
    private conversationsService: ConversationsService,
    private rateLimitingService: RateLimitingService,
    private lineReputationService: LineReputationService,
    private logger: AppLoggerService,
    private spintaxService: SpintaxService,
    private phoneValidationService: PhoneValidationService,
    private humanizationService: HumanizationService,
    private messageSendingService: MessageSendingService,
  ) { }

  @Process('send-campaign-message')
  async handleSendMessage(job: Job) {
    let {
      campaignId,
      contactName,
      contactPhone,
      contactSegment,
      lineId,
      message,
      useTemplate,
      templateId,
      templateVariables,
    } = job.data;

    try {
      // Verificar se a campanha ainda existe (pode ter sido deletada/parada pelo usuário)
      const campaignExists = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true }
      });

      if (!campaignExists) {
        console.log(`🛑 [Campaigns] Campanha ${campaignId} não encontrada (deletada?), cancelando envio para ${contactPhone}`);
        return;
      }

      // Verificar se está na blocklist
      const isBlocked = await this.blocklistService.isBlocked(contactPhone);
      if (isBlocked) {
        console.log(`❌ Contato ${contactPhone} está na blocklist`);
        await this.prisma.campaign.update({
          where: { id: campaignId },
          data: { response: false },
        });
        return;
      }

      // Buscar a linha
      const line = await this.prisma.linesStock.findUnique({
        where: { id: lineId },
      });

      if (!line || line.lineStatus !== 'active') {
        throw new Error('Linha não disponível');
      }

      // Rate Limiting: Verificar se a linha pode enviar mensagem (CAMPANHAS TAMBÉM RESPEITAM LIMITES)
      const canSend = await this.rateLimitingService.canSendMessage(lineId);
      if (!canSend) {
        const rateLimitInfo = await this.rateLimitingService.getRateLimitInfo(lineId);
        this.logger.warn(
          `Campanha: Limite de mensagens atingido para linha ${line.phone}`,
          'CampaignsProcessor',
          { campaignId, lineId, rateLimitInfo },
        );
        throw new Error(`Limite de mensagens atingido (${rateLimitInfo.messagesToday}/${rateLimitInfo.limit.daily} hoje)`);
      }

      // Verificar reputação da linha
      const isLineHealthy = await this.lineReputationService.isLineHealthy(lineId);
      if (!isLineHealthy) {
        this.logger.warn(
          `Campanha: Linha ${line.phone} com baixa reputação`,
          'CampaignsProcessor',
          { campaignId, lineId },
        );
        // Desabilitado bloqueio por reputação temporariamente para permitir envio
        // throw new Error('Linha com baixa reputação, envio bloqueado');
      }

      // Buscar evolução
      const evolution = await this.prisma.evolution.findUnique({
        where: { evolutionName: line.evolutionName },
      });

      if (!evolution) {
        throw new Error('Evolution não encontrada');
      }

      const instanceName = `line_${line.phone.replace(/\D/g, '')}`;
      // Normalizar telefone (remover espaços, hífens, adicionar 55 se necessário)
      const cleanPhone = this.phoneValidationService.cleanPhone(contactPhone);

      let retries = 0;
      let sent = false;
      let finalMessage = message || 'Olá! Esta é uma mensagem da nossa campanha.';

      while (retries < 3 && !sent) {
        try {
          // ========== PREVENÇÃO DE BANIMENTO ==========
          // 1. Enviar typing indicator para simular digitação humana
          try {
            await this.messageSendingService.sendTypingIndicator(
              evolution.evolutionUrl,
              evolution.evolutionKey,
              instanceName,
              cleanPhone,
              true,
            );
            this.logger.log(
              `📝 [Campanha] Typing indicator enviado para ${cleanPhone}`,
              'CampaignsProcessor',
              { campaignId, contactPhone: cleanPhone },
            );
          } catch (typingError: any) {
            // Não bloquear envio se typing falhar
            this.logger.warn(
              `⚠️ [Campanha] Erro ao enviar typing indicator`,
              'CampaignsProcessor',
              { campaignId, error: typingError.message },
            );
          }

          // 2. Delay humanizado de 5-15 segundos (anti-ban)
          const delayMs = await this.humanizationService.getMassiveMessageDelay(5, 15);
          this.logger.log(
            `⏱️ [Campanha] Delay anti-ban: ${Math.round(delayMs / 1000)}s`,
            'CampaignsProcessor',
            { campaignId, delayMs },
          );
          await this.humanizationService.sleep(delayMs);
          // ===============================================

          // Verificar se é fluxo de saudação (Anti-ban)
          let isGreetingFlow = false;
          let realPayload = '';

          try {
            if (message && message.trim().startsWith('{')) {
              try {
                let parsed = JSON.parse(message);

                // Handle double-stringified JSON (e.g. "{\"greeting\":...}")
                if (typeof parsed === 'string') {
                  try {
                    parsed = JSON.parse(parsed);
                  } catch (e) {
                    // Ignore second parse error
                  }
                }

                if (parsed.greeting && Array.isArray(parsed.greeting) && parsed.content) {
                  isGreetingFlow = true;
                  realPayload = parsed.content;

                  // Escolher saudação aleatória
                  const randomGreeting = parsed.greeting[Math.floor(Math.random() * parsed.greeting.length)];

                  // Processar Spintax da saudação
                  message = this.spintaxService.applySpintax(randomGreeting);
                  finalMessage = message; // Atualizar finalMessage para envio

                  // Se for greeting, forçamos modo texto e ignoramos template inicial
                  // (O template/payload real será enviado na resposta)
                  useTemplate = false;

                  this.logger.log(`👋 [Campaigns] Modo Saudação: Enviando "${message}"`, 'CampaignsProcessor');
                }
              } catch (e) {
                this.logger.error(`❌ [Campaigns] Erro ao processar JSON de saudação: ${e.message}`, e.stack, 'CampaignsProcessor');
                // Se falhar o parse, TENTAR recuperar o conteúdo para não mandar o JSON bruto
                // Se for impossível, melhor falhar o job do que mandar lixo pro cliente
                try {
                  // Tentar extrair content via regex como fallback extremo
                  // Handle escaped quotes in regex for double-stringified case
                  const contentMatch = message.match(/\\"content\\"\s*:\s*\\"([^"]+)\\"/) || message.match(/"content"\s*:\s*"([^"]+)"/);
                  if (contentMatch && contentMatch[1]) {
                    message = contentMatch[1];
                    this.logger.warn(`⚠️ [Campaigns] Recuperado conteúdo via Regex: "${message}"`, 'CampaignsProcessor');
                  } else {
                    this.logger.warn(`⚠️ [Campaigns] Falha total no parse, enviando mensagem original (risco de raw JSON)`, 'CampaignsProcessor');
                  }
                } catch (e2) { }
              }
            }
          } catch (outerError) {
            // Ignorar erro do bloco de greeting
          }

          // Se usar template, enviar via template
          if (useTemplate && templateId) {
            const template = await this.prisma.template.findUnique({
              where: { id: templateId },
            });

            if (!template) {
              throw new Error('Template não encontrado');
            }

            // Substituir variáveis no template
            let templateText = template.bodyText;
            const variables: TemplateVariable[] = templateVariables ?
              (typeof templateVariables === 'string' ? JSON.parse(templateVariables) : templateVariables)
              : [];

            variables.forEach((v: TemplateVariable, index: number) => {
              templateText = templateText.replace(`{{${index + 1}}}`, v.value);
              templateText = templateText.replace(`{{${v.key}}}`, v.value);
            });

            finalMessage = templateText;

            // Se linha oficial, enviar via Cloud API
            const sentId = line.oficial && line.token && line.numberId
              ? await this.sendTemplateViaCloudApi(line, template, cleanPhone, variables)
              : await this.sendTemplateViaEvolution(evolution, instanceName, template, cleanPhone, variables);

            if (sentId) {
              await this.prisma.campaign.update({
                where: { id: campaignId },
                data: { messageId: sentId }
              });
            }

            // Registrar envio de template
            await this.prisma.templateMessage.create({
              data: {
                templateId: template.id,
                contactPhone,
                contactName,
                lineId,
                status: 'SENT',
                variables: variables.length > 0 ? JSON.stringify(variables) : null,
                campaignId,
              },
            });
          } else {
            // Envio de mensagem de texto normal
            // Envio de mensagem de texto normal
            const response = await axios.post(
              `${evolution.evolutionUrl}/message/sendText/${instanceName}`,
              {
                number: cleanPhone,
                text: finalMessage,
              },
              {
                headers: {
                  'apikey': evolution.evolutionKey,
                },
              }
            );

            // Tentar extrair messageId da resposta da Evolution
            if (response.data && response.data.key && response.data.key.id) {
              await this.prisma.campaign.update({
                where: { id: campaignId },
                data: { messageId: response.data.key.id }
              });
            }
          }

          sent = true;

          // Buscar operadores da linha e distribuir (máximo 2)
          const lineOperators = await this.prisma.lineOperator.findMany({
            where: { lineId },
            include: {
              user: true,
            },
          });

          // Filtrar apenas operadores online
          const onlineOperators = lineOperators
            .filter(lo => lo.user.status === 'Online' && lo.user.role === 'operator')
            .map(lo => lo.user);

          // Se não houver operadores online, usar null (sistema)
          let assignedOperatorId: number | null = null;
          if (onlineOperators.length > 0) {
            // Distribuir de forma round-robin: contar conversas ativas de cada operador
            const operatorConversationCounts = await Promise.all(
              onlineOperators.map(async (operator) => {
                const count = await this.prisma.conversation.count({
                  where: {
                    userLine: lineId,
                    userId: operator.id,
                    tabulation: null,
                  },
                });
                return { operatorId: operator.id, count };
              })
            );

            operatorConversationCounts.sort((a, b) => a.count - b.count);
            assignedOperatorId = operatorConversationCounts[0]?.operatorId || onlineOperators[0]?.id || null;
          }

          // Registrar conversa
          await this.conversationsService.create({
            contactName,
            contactPhone,
            segment: contactSegment,
            userName: 'Sistema',
            userLine: lineId,
            userId: assignedOperatorId, // Operador específico que vai receber a resposta
            message: useTemplate ? `[TEMPLATE] ${finalMessage}` : finalMessage,
            sender: 'operator',
            messageType: useTemplate ? 'template' : 'text',
          });

          // Atualizar campanha com sucesso e data de disparo
          // Se for fluxo de saudação, NÃO marcamos response=true, pois aguardamos a resposta do cliente
          await this.prisma.campaign.update({
            where: { id: campaignId },
            data: {
              response: !isGreetingFlow, // True apenas se NÃO for saudação
              dispatchedAt: new Date(), // Data/hora efetiva do disparo
            },
          });

          console.log(`✅ Mensagem ${useTemplate ? '(template)' : ''} enviada para ${contactPhone}`);
        } catch (error) {
          retries++;
          console.error(`Tentativa ${retries} falhou para ${contactPhone}:`, error.message);

          if (retries >= 3) {
            await this.prisma.campaign.update({
              where: { id: campaignId },
              data: {
                response: false,
                retryCount: retries,
              },
            });

            // Se template, registrar falha
            if (useTemplate && templateId) {
              await this.prisma.templateMessage.create({
                data: {
                  templateId,
                  contactPhone,
                  contactName,
                  lineId,
                  status: 'FAILED',
                  errorMessage: error.message,
                  campaignId,
                },
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('Erro ao processar campanha:', error);
      throw error;
    }
  }

  /**
   * Envia template via WhatsApp Cloud API
   */
  private async sendTemplateViaCloudApi(
    line: any,
    template: any,
    phone: string,
    variables: TemplateVariable[],
  ): Promise<string | null> {
    const components: any[] = [];

    // Body com variáveis
    if (variables.length > 0) {
      components.push({
        type: 'body',
        parameters: variables.map(v => ({
          type: 'text',
          text: v.value,
        })),
      });
    }

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${line.numberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          components: components.length > 0 ? components : undefined,
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${line.token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data?.messages?.[0]?.id || null;
  }

  /**
   * Envia template via Evolution API
   */
  private async sendTemplateViaEvolution(
    evolution: any,
    instanceName: string,
    template: any,
    phone: string,
    variables: TemplateVariable[],
  ): Promise<string | null> {
    // Substituir variáveis no texto do template
    let messageText = template.bodyText;
    variables.forEach((v: TemplateVariable, index: number) => {
      messageText = messageText.replace(`{{${index + 1}}}`, v.value);
      messageText = messageText.replace(`{{${v.key}}}`, v.value);
    });

    // Tenta enviar como template primeiro
    try {
      const response = await axios.post(
        `${evolution.evolutionUrl}/message/sendTemplate/${instanceName}`,
        {
          number: phone,
          name: template.name,
          language: template.language,
          components: variables.length > 0 ? [{
            type: 'body',
            parameters: variables.map(v => ({
              type: 'text',
              text: v.value,
            })),
          }] : undefined,
        },
        {
          headers: { 'apikey': evolution.evolutionKey },
        }
      );
      return response.data?.key?.id || null;
    } catch (error) {
      // Fallback: envia como mensagem de texto
      console.log('Fallback para mensagem de texto:', error.message);
      const response = await axios.post(
        `${evolution.evolutionUrl}/message/sendText/${instanceName}`,
        {
          number: phone,
          text: messageText,
        },
        {
          headers: { 'apikey': evolution.evolutionKey },
        }
      );
      return response.data?.key?.id || null;
    }
  }
}
