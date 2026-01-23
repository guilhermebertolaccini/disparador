import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Upload, CheckCircle, Loader2, Trash2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { GlassCard } from "@/components/ui/glass-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CrudTable, Column } from "@/components/crud/CrudTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  campaignsService,
  segmentsService,
  templatesService,
  Campaign as APICampaign,
  CampaignStats,
  Segment,
  Template as APITemplate
} from "@/services/api";
import { format } from "date-fns";

interface Campaign {
  id: string;
  name: string;
  segment: string;
  segmentId: number;
  speed: 'fast' | 'medium' | 'slow';
  date: string;
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed?: number;
}

const speedColors = {
  fast: "bg-destructive",
  medium: "bg-warning text-warning-foreground",
  slow: "bg-success"
};

const speedLabels = {
  fast: "Rápida (3min)",
  medium: "Média (6min)",
  slow: "Lenta (10min)"
};

export default function Campanhas() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [templates, setTemplates] = useState<APITemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<{
    name: string;
    segment: string;
    speed: 'fast' | 'medium' | 'slow';
    // greeting removed from state, using hardcoded list
    message: string;
    useTemplate: boolean;
    templateId: string;
  }>({
    name: '',
    segment: '',
    speed: 'medium',
    message: '',
    useTemplate: false,
    templateId: '',
  });

  const HARDCODED_GREETINGS = [
    "Olá, tudo bem?",
    "Oi, tudo bem?",
    "Oi! Tudo certo?",
    "Olá! Tudo certo por aí?",
    "Oi, como você está?",
    "Olá, como vai você?",
    "Oi! Como vai?",
    "E aí, tudo bem?",
    "E aí, tudo certo?",
    "Tudo bem por aí?",
    "Tudo certo com você?",
    "Como você tem passado?",
    "Como tem sido seu dia?",
    "Como estão as coisas?",
    "Como vai a vida?",
    "Oi! Como você tá?",
    "Fala! Tudo bem?",
    "Boa! Tudo certo?",
    "Bom dia! Tudo bem?",
    "Boa tarde! Tudo bem?"
  ];
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showResult, setShowResult] = useState(false);
  const [resultData, setResultData] = useState({ total: 0, sent: 0, failed: 0 });
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaignStats, setCampaignStats] = useState<CampaignStats | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await campaignsService.getCampaignSummaries();

      const formatted: Campaign[] = data.map((c: any) => {
        const segment = segments.find(s => s.id === c.contactSegment);
        return {
          id: c.name, // Usando nome como ID visual
          name: c.name,
          segment: segment?.name || `Segmento ${c.contactSegment}`,
          segmentId: c.contactSegment,
          speed: 'slow',
          date: format(new Date(c.createdAt), 'yyyy-MM-dd HH:mm'),
          total: c.total,
          sent: c.sent,
          delivered: c.delivered,
          read: c.read
        };
      });

      setCampaigns(formatted);
    } catch (error) {
      toast({
        title: "Erro ao carregar campanhas",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [segments]);

  const loadSegments = useCallback(async () => {
    try {
      const data = await segmentsService.list();
      setSegments(data);
    } catch (error) {
      console.error('Error loading segments:', error);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await templatesService.list({ status: 'APPROVED' });
      setTemplates(data);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  }, []);

  useEffect(() => {
    loadSegments();
    loadTemplates();
  }, [loadSegments, loadTemplates]);

  useEffect(() => {
    if (segments.length > 0) {
      loadCampaigns();
    }
  }, [segments, loadCampaigns]);

  const columns: Column<Campaign>[] = [
    { key: "name", label: "Nome" },
    { key: "segment", label: "Segmento" },
    { key: "date", label: "Data" },
    { key: "total", label: "Base" },
    { key: "sent", label: "Enviado" },
    { key: "read", label: "Lido" },
    { key: "nextMessageAt", label: "Próxima Msg" },
    {
      key: "actions",
      label: "Ações",
      render: (campaign) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => {
              setCampaignToDelete(campaign.name);
              setDeleteDialogOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )
    }
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.segment) {
      toast({
        title: "Campos obrigatórios",
        description: "Nome e segmento são obrigatórios",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Prepare message payload
      // If user wants greeting flow, we wrap greeting + message in JSON
      // But only if we have greetings defined.
      // The requirement: "podemos deixar setado varias formas de chama tipo 'Olá tudo bem?'..."

      let finalMessage = formData.message.trim();
      // Always use hardcoded greetings for anti-ban flow if message is present
      if (finalMessage) {
        // Create JSON payload for Greeting Flow
        finalMessage = JSON.stringify({
          greeting: HARDCODED_GREETINGS,
          content: finalMessage
        });
      }

      // Create campaign
      const campaign = await campaignsService.create({
        name: formData.name.trim(),
        speed: 'slow', // Sempre lento para anti-ban
        segment: formData.segment,
        useTemplate: formData.useTemplate,
        templateId: formData.useTemplate && formData.templateId ? parseInt(formData.templateId) : undefined,
      });

      // Upload CSV if provided
      if (csvFile) {
        const uploadResult = await campaignsService.uploadCSV(
          campaign.id,
          csvFile,
          finalMessage || undefined
        );

        setResultData({
          total: uploadResult.contactsAdded,
          sent: uploadResult.contactsAdded,
          failed: 0,
        });
      } else {
        setResultData({ total: 0, sent: 0, failed: 0 });
      }

      setShowResult(true);
      toast({
        title: "Campanha criada",
        description: "Campanha criada com sucesso",
      });

      // Reset form
      setFormData({
        name: '',
        segment: '',
        speed: 'medium',
        message: '',
        useTemplate: false,
        templateId: '',
      });
      setCsvFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Reload campaigns
      await loadCampaigns();

      setTimeout(() => setShowResult(false), 5000);
    } catch (error) {
      toast({
        title: "Erro ao criar campanha",
        description: error instanceof Error ? error.message : "Erro ao criar campanha",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewStats = async (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setIsStatsOpen(true);
    setIsLoadingStats(true);
    setCampaignStats(null);

    try {
      const stats = await campaignsService.getStats(campaign.name);
      setCampaignStats(stats);
    } catch (error) {
      toast({
        title: "Erro ao carregar estatísticas",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setIsLoadingStats(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCsvFile(file);
    }
  };

  const handleDeleteCampaign = async () => {
    if (!campaignToDelete) return;

    try {
      await campaignsService.deleteByName(campaignToDelete);
      toast({
        title: "Campanha excluída",
        description: "A campanha e suas mensagens pendentes foram removidas.",
      });
      loadCampaigns();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    } finally {
      setDeleteDialogOpen(false);
      setCampaignToDelete(null);
    }
  };

  return (
    <MainLayout>
      <div className="h-full overflow-y-auto scrollbar-content">
        <div className="space-y-6 animate-fade-in">
          {/* Create Campaign */}
          <GlassCard>
            <h2 className="text-xl font-semibold text-foreground mb-6">Criar Campanha</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome da Campanha *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Ex: Promoção Janeiro"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="segment">Segmento *</Label>
                  <Select value={formData.segment} onValueChange={(value) => setFormData({ ...formData, segment: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {segments.map((segment) => (
                        <SelectItem key={segment.id} value={segment.id.toString()}>
                          {segment.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="message">Mensagem (opcional)</Label>
                <Textarea
                  id="message"
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Digite a mensagem da campanha..."
                  rows={3}
                />
              </div>

              {/* Greeting Configuration Removed - Using Hardcoded List */}
              <div className="p-4 bg-secondary/20 rounded-lg border border-secondary/40">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-secondary-foreground font-semibold">👋 Abordagem Amigável (Ativo)</span>
                  <Badge variant="outline" className="text-xs font-normal bg-success/10 text-success border-success/30">Auto</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  O sistema enviará automaticamente uma das 20 variações de saudação (ex: "Olá, tudo bem?", "E aí?") antes da mensagem principal.
                </p>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="useTemplate"
                    checked={formData.useTemplate}
                    onCheckedChange={(checked) => setFormData({ ...formData, useTemplate: checked === true })}
                  />
                  <Label htmlFor="useTemplate" className="text-sm font-normal">
                    Usar Template
                  </Label>
                </div>
                {formData.useTemplate && (
                  <Select value={formData.templateId} onValueChange={(value) => setFormData({ ...formData, templateId: value })}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Selecione um template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id.toString()}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="csv">Arquivo CSV</Label>
                <div className="flex items-center gap-4">
                  <Input
                    id="csv"
                    type="file"
                    accept=".csv"
                    className="max-w-xs"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {isSubmitting ? 'Enviando...' : 'Enviar Campanha'}
                  </Button>
                </div>
              </div>
            </form>

            {showResult && (
              <div className="mt-6 p-4 bg-success/10 border border-success/30 rounded-xl animate-fade-in">
                <div className="flex items-center gap-2 text-success mb-2">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-semibold">Campanha enviada com sucesso!</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {resultData.total} contatos processados • {resultData.sent} enviados • {resultData.failed} falhas
                </p>
              </div>
            )}
          </GlassCard>

          {/* Campaigns List */}
          <CrudTable
            title="Campanhas"
            subtitle="Histórico de campanhas enviadas"
            columns={columns}
            data={campaigns}
            searchPlaceholder="Buscar campanhas..."
            onEdit={handleViewStats}
          />
        </div>

        {/* Stats Modal */}
        <Dialog open={isStatsOpen} onOpenChange={setIsStatsOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Estatísticas da Campanha</DialogTitle>
            </DialogHeader>
            {selectedCampaign && (
              <div className="py-4">
                <h3 className="font-semibold mb-4">{selectedCampaign.name}</h3>
                {isLoadingStats ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : campaignStats ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-primary/10 rounded-xl">
                      <p className="text-2xl font-bold text-primary">{campaignStats.totalContacts}</p>
                      <p className="text-sm text-muted-foreground">Total</p>
                    </div>
                    <div className="p-4 bg-success/10 rounded-xl">
                      <p className="text-2xl font-bold text-success">{campaignStats.sent}</p>
                      <p className="text-sm text-muted-foreground">Enviados</p>
                    </div>
                    <div className="p-4 bg-warning/10 rounded-xl">
                      <p className="text-2xl font-bold text-warning">{campaignStats.responses}</p>
                      <p className="text-sm text-muted-foreground">Respostas</p>
                    </div>
                    <div className="p-4 bg-muted rounded-xl">
                      <p className="text-2xl font-bold text-foreground">{campaignStats.pending}</p>
                      <p className="text-sm text-muted-foreground">Pendentes</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-4">
                    Nenhuma estatística disponível
                  </p>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir Campanha e Parar Envios?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. Isso excluirá permanentemente a campanha
                e cancelará todas as mensagens que ainda não foram enviadas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteCampaign} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Excluir e Parar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout >
  );
}
