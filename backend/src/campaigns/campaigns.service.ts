import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { CampaignContact } from './dto/upload-campaign.dto';
import { ContactsService } from '../contacts/contacts.service';
import { UsersService } from '../users/users.service';
import { PhoneValidationService } from '../phone-validation/phone-validation.service';

@Injectable()
export class CampaignsService {
  constructor(
    @InjectQueue('campaigns') private campaignsQueue: Queue,
    private prisma: PrismaService,
    private contactsService: ContactsService,
    private usersService: UsersService,
    private phoneValidationService: PhoneValidationService,
  ) { }

  async create(createCampaignDto: CreateCampaignDto) {
    // Converter endTime (HH:mm) para DateTime do dia atual
    let endTimeDate: Date | null = null;
    if (createCampaignDto.endTime) {
      const [hours, minutes] = createCampaignDto.endTime.split(':').map(Number);
      endTimeDate = new Date();
      endTimeDate.setHours(hours, minutes, 0, 0);
      // Se o horário já passou hoje, definir para amanhã
      if (endTimeDate < new Date()) {
        endTimeDate.setDate(endTimeDate.getDate() + 1);
      }
    }

    return this.prisma.campaign.create({
      data: {
        name: createCampaignDto.name,
        contactName: '',
        contactPhone: '',
        contactSegment: parseInt(createCampaignDto.segment),
        speed: createCampaignDto.speed,
        useTemplate: createCampaignDto.useTemplate || false,
        templateId: createCampaignDto.templateId,
        templateVariables: createCampaignDto.templateVariables
          ? JSON.stringify(createCampaignDto.templateVariables)
          : null,
        endTime: endTimeDate,
      },
    });
  }

  async uploadCampaign(
    campaignId: number,
    contacts: CampaignContact[],
    message?: string,
    useTemplate?: boolean,
    templateId?: number,
  ) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new NotFoundException('Campanha não encontrada');
    }

    // Buscar linhas ATIVAS do segmento (não precisa de operadores online)
    const segmentLines = await this.prisma.linesStock.findMany({
      where: {
        lineStatus: 'active',
        ...(campaign.contactSegment ? { segment: campaign.contactSegment } : {}),
      },
    });

    // Se não tiver linhas no segmento, tentar segmento "Padrão"
    let availableLines = segmentLines.map(line => line.id);

    if (availableLines.length === 0) {
      const defaultSegment = await this.prisma.segment.findUnique({
        where: { name: 'Padrão' },
      });

      if (defaultSegment) {
        const defaultLines = await this.prisma.linesStock.findMany({
          where: {
            lineStatus: 'active',
            segment: defaultSegment.id,
          },
        });
        availableLines = defaultLines.map(line => line.id);
      }
    }

    if (availableLines.length === 0) {
      throw new BadRequestException('Nenhuma linha ativa disponível para disparo');
    }

    console.log(`📤 [Campanha] ${contacts.length} contatos serão disparados usando ${availableLines.length} linhas em rotação`);

    // Cada mensagem será agendada com delay individual
    const minDelayMinutes = 0.5; // 30 segundos
    const maxDelayMinutes = 2.5; // 2 minutos e 30 segundos

    // Usar parâmetros do upload ou da campanha
    const finalUseTemplate = useTemplate !== undefined ? useTemplate : (campaign.useTemplate || false);
    const finalTemplateId = templateId !== undefined ? templateId : campaign.templateId;

    // Processar cada contato com delay acumulado
    let accumulatedDelayMs = 0;

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];

      // Normalizar telefone (remover espaços, hífens, adicionar 55 se necessário)
      const normalizedPhone = this.phoneValidationService.cleanPhone(contact.phone);

      // Rotação round-robin: linha 1, linha 2, linha 1, linha 2...
      const lineIndex = i % availableLines.length;
      const lineId = availableLines[lineIndex];

      // Criar ou atualizar contato
      let existingContact = await this.contactsService.findByPhone(normalizedPhone);
      if (!existingContact) {
        await this.contactsService.create({
          name: contact.name,
          phone: normalizedPhone,
          cpf: contact.cpf,
          contract: contact.contract,
          segment: campaign.contactSegment,
        });
      } else if (contact.cpf || contact.contract) {
        await this.contactsService.update(existingContact.id, {
          cpf: contact.cpf || existingContact.cpf,
          contract: contact.contract || existingContact.contract,
        });
      }

      // Usar mensagem do contato se disponível, senão usar mensagem global
      const contactMessage = contact.message || message;

      // Criar registro da campanha
      const campaignRecord = await this.prisma.campaign.create({
        data: {
          name: campaign.name,
          contactName: contact.name,
          contactPhone: normalizedPhone,
          contactSegment: campaign.contactSegment,
          lineReceptor: lineId,
          speed: 'slow', // Sempre lento para anti-ban
          response: false,
          useTemplate: finalUseTemplate,
          templateId: finalTemplateId,
          templateVariables: campaign.templateVariables,
          endTime: campaign.endTime,
          message: contactMessage,
        },
      });

      // Adicionar à fila com delay acumulado
      await this.campaignsQueue.add(
        'send-campaign-message',
        {
          campaignId: campaignRecord.id,
          contactName: contact.name,
          contactPhone: normalizedPhone,
          contactSegment: campaign.contactSegment,
          lineId: lineId,
          message: contactMessage,
          useTemplate: finalUseTemplate,
          templateId: finalTemplateId,
          templateVariables: campaign.templateVariables,
        },
        {
          delay: accumulatedDelayMs,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }
      );

      // Calcular delay aleatório para próxima mensagem (30s - 2.5min)
      const randomDelayMinutes = minDelayMinutes + Math.random() * (maxDelayMinutes - minDelayMinutes);
      accumulatedDelayMs += randomDelayMinutes * 60 * 1000;

      // PAUSA LONGA: A cada ~20 mensagens, fazer pausa de 5-15 minutos (anti-ban)
      if ((i + 1) % 20 === 0 && i < contacts.length - 1) {
        const longPauseMinutes = 5 + Math.random() * 10; // 5-15 minutos
        accumulatedDelayMs += longPauseMinutes * 60 * 1000;
        console.log(`☕ [Campanha] Pausa longa de ${longPauseMinutes.toFixed(1)}min após ${i + 1} mensagens`);
      }

      console.log(`📤 [Campanha] Contato ${i + 1}/${contacts.length}: ${normalizedPhone} → Linha ${lineId} (delay: ${Math.round(accumulatedDelayMs / 60000)}min)`);
    }

    const estimatedCompletionMs = accumulatedDelayMs;
    const estimatedCompletion = new Date(Date.now() + estimatedCompletionMs);

    return {
      message: `Campanha processada com sucesso. ${contacts.length} contatos agendados para envio.`,
      totalContacts: contacts.length,
      lines: availableLines.length,
      averageDelayMinutes: ((minDelayMinutes + maxDelayMinutes) / 2).toFixed(1),
      estimatedCompletion: estimatedCompletion.toISOString(),
      estimatedDurationMinutes: Math.round(estimatedCompletionMs / 60000),
    };
  }

  async findAll(filters?: any) {
    // Remover campos inválidos que não existem no schema
    const { search, ...validFilters } = filters || {};

    // Se houver busca por texto, aplicar filtros
    const where = search
      ? {
        ...validFilters,
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
          { contactPhone: { contains: search } },
        ],
      }
      : validFilters;

    return this.prisma.campaign.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: number) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
    });

    if (!campaign) {
      throw new NotFoundException(`Campanha com ID ${id} não encontrada`);
    }

    return campaign;
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.campaign.delete({
      where: { id },
    });
  }

  async getStats(campaignName: string) {
    // Buscar todas as campanhas com este nome
    const campaigns = await this.prisma.campaign.findMany({
      where: { name: campaignName },
      select: {
        id: true,
        contactPhone: true,
        response: true,
        delivered: true,
        read: true,
        dispatchedAt: true,
        dateTime: true,
        createdAt: true,
      },
    });

    const total = campaigns.length;
    const sent = campaigns.filter(c => c.response === true).length;
    const failed = campaigns.filter(c => c.response === false && c.dispatchedAt !== null).length;
    const pending = campaigns.filter(c => c.response === false && c.dispatchedAt === null).length;
    const delivered = campaigns.filter(c => c.delivered === true).length;
    const read = campaigns.filter(c => c.read === true).length;

    // Buscar contatos que responderam (verificar na tabela Conversation)
    const contactPhones = campaigns.map(c => c.contactPhone);
    const earliestCampaignTime = campaigns.length > 0
      ? new Date(Math.min(...campaigns.map(c => c.dateTime?.getTime() || c.createdAt.getTime())))
      : new Date();

    // Buscar conversas onde o contato respondeu após o envio da campanha
    const conversations = await this.prisma.conversation.findMany({
      where: {
        contactPhone: { in: contactPhones },
        sender: 'contact', // Mensagens do contato (respostas)
        datetime: { gte: earliestCampaignTime },
      },
      select: {
        contactPhone: true,
      },
    });

    // Contar contatos únicos que responderam
    const uniqueResponders = new Set(conversations.map(c => c.contactPhone));
    const responses = uniqueResponders.size;

    return {
      campaignName,
      totalContacts: total,
      sent,
      pending,
      failed,
      delivered,
      read,
      responses,
      successRate: total > 0 ? ((sent / total) * 100).toFixed(1) : '0',
      deliveryRate: sent > 0 ? ((delivered / sent) * 100).toFixed(1) : '0',
      readRate: sent > 0 ? ((read / sent) * 100).toFixed(1) : '0',
      responseRate: sent > 0 ? ((responses / sent) * 100).toFixed(1) : '0',
    };
  }
}
