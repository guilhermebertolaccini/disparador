export interface CampaignContact {
  name: string;
  phone: string;
  cpf?: string;
  contract?: string;
  segment?: number;
  message?: string; // Mensagem personalizada por contato (opcional)
}
