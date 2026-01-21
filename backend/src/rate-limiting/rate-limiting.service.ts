import { Injectable, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LineReputationService } from '../line-reputation/line-reputation.service';

interface RateLimit {
  daily: number;
  hourly: number;
}

@Injectable()
export class RateLimitingService {
  // Limites AUMENTADOS (Pedido User: 300 msg/dia novas, 450 msg/dia outras)
  private readonly baseLimits: Record<string, RateLimit> = {
    newLine: { daily: 300, hourly: 50 },      // Linhas novas (<7 dias) - 50 msg/hora, 300/dia
    warmingUp: { daily: 450, hourly: 80 },    // Linhas aquecendo (7-30 dias) - 80 msg/hora, 450/dia
    mature: { daily: 450, hourly: 80 },       // Linhas maduras (>30 dias) - 80 msg/hora, 450/dia
  };

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => LineReputationService))
    private lineReputationService?: LineReputationService,
  ) { }

  /**
   * Verifica se uma linha pode enviar mensagem baseado no rate limit
   * @param lineId ID da linha
   * @returns true se pode enviar, false caso contrário
   */
  async canSendMessage(lineId: number): Promise<boolean> {
    try {
      const line = await this.prisma.linesStock.findUnique({
        where: { id: lineId },
      });

      if (!line) return false;

      const lineAge = this.getLineAge(line.createdAt);
      const limit = await this.getLimit(lineAge, lineId);

      // Contar mensagens enviadas hoje
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const messagesToday = await this.prisma.conversation.count({
        where: {
          userLine: lineId,
          sender: 'operator',
          datetime: { gte: today },
        },
      });

      // Contar mensagens na última hora
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);

      const messagesLastHour = await this.prisma.conversation.count({
        where: {
          userLine: lineId,
          sender: 'operator',
          datetime: { gte: oneHourAgo },
        },
      });

      const canSend = messagesToday < limit.daily && messagesLastHour < limit.hourly;

      if (!canSend) {
        console.log(`⚠️ [RateLimit] Linha ${lineId} atingiu limite: ${messagesToday}/${limit.daily} dia, ${messagesLastHour}/${limit.hourly} hora`);
      }

      return canSend;
    } catch (error) {
      console.error(`❌ [RateLimit] Erro ao verificar limite:`, error.message);
      return true; // Em caso de erro, permite envio
    }
  }

  /**
   * Obtém o limite de mensagens baseado na idade da linha
   */
  private async getLimit(lineAge: number, lineId: number): Promise<RateLimit> {
    if (lineAge < 7) {
      return this.baseLimits.newLine;
    } else if (lineAge < 30) {
      return this.baseLimits.warmingUp;
    } else {
      return this.baseLimits.mature;
    }
  }

  /**
   * Calcula a idade da linha em dias
   * @param createdAt Data de criação da linha
   * @returns Idade em dias
   */
  private getLineAge(createdAt: Date): number {
    const now = new Date();
    const diffTime = now.getTime() - createdAt.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24)); // Converter para dias
  }

  /**
   * Obtém informações sobre o rate limit de uma linha
   * @param lineId ID da linha
   * @returns Informações sobre o rate limit
   */
  async getRateLimitInfo(lineId: number): Promise<{
    lineAge: number;
    limit: RateLimit;
    messagesToday: number;
    messagesLastHour: number;
    canSend: boolean;
  }> {
    const line = await this.prisma.linesStock.findUnique({
      where: { id: lineId },
    });

    if (!line) {
      throw new BadRequestException('Linha não encontrada');
    }

    const lineAge = this.getLineAge(line.createdAt);
    const limit = await this.getLimit(lineAge, lineId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const messagesToday = await this.prisma.conversation.count({
      where: {
        userLine: lineId,
        sender: 'operator',
        datetime: {
          gte: today,
        },
      },
    });

    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const messagesLastHour = await this.prisma.conversation.count({
      where: {
        userLine: lineId,
        sender: 'operator',
        datetime: {
          gte: oneHourAgo,
        },
      },
    });

    const canSend = messagesToday < limit.daily && messagesLastHour < limit.hourly;

    return {
      lineAge,
      limit,
      messagesToday,
      messagesLastHour,
      canSend,
    };
  }
}

