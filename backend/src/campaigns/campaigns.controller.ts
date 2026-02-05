import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Query,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { CampaignsService } from "./campaigns.service";
import { CreateCampaignDto } from "./dto/create-campaign.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Role } from "@prisma/client";
import csv from "csv-parser";
import { Readable } from "stream";

@ApiTags("campaigns")
@ApiBearerAuth("JWT-auth")
@Controller("campaigns")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) { }

  @Post()
  @Roles(Role.admin, Role.supervisor, Role.digital)
  create(@Body() createCampaignDto: CreateCampaignDto) {
    console.log(
      "📋 [Campaigns] Criando campanha:",
      JSON.stringify(createCampaignDto, null, 2)
    );
    return this.campaignsService.create(createCampaignDto);
  }

  @Post(":id/upload")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  @UseInterceptors(FileInterceptor("file"))
  async uploadCsv(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body("message") message?: string,
    @Body("useTemplate") useTemplate?: string,
    @Body("templateId") templateId?: string
  ) {
    console.log(`📤 [Campaigns] Upload CSV recebido para campanha ${id}`);
    console.log(
      `📄 [Campaigns] Arquivo:`,
      file
        ? { name: file.originalname, size: file.size, mimetype: file.mimetype }
        : "NENHUM"
    );
    console.log(`📝 [Campaigns] Mensagem: ${message || "Nenhuma"}`);

    if (!file) {
      console.error("❌ [Campaigns] Arquivo CSV não recebido");
      throw new BadRequestException("Arquivo CSV é obrigatório");
    }

    const contacts = [];
    const stream = Readable.from(file.buffer.toString());
    console.log(`📊 [Campaigns] Processando CSV...`);

    return new Promise((resolve, reject) => {
      stream
        .pipe(csv({ separator: ';' }))
        .on("data", (row) => {
          console.log("📝 [Campaigns] Row do CSV:", row);
          // Ignorar linhas vazias ou sem telefone
          // Limpeza robusta do telefone: manter apenas dígitos
          const phoneRaw = (row.phone || '').toString();
          const phoneClean = phoneRaw.replace(/\D/g, '');

          // Validar se sobrou um número válido (pelo menos 8 dígitos)
          if (phoneClean.length < 8) return;

          contacts.push({
            name: row.name || '', // Nome opcional, envia vazio se não tiver
            phone: phoneClean,
            cpf: row.cpf || undefined,
            contract: row.contrato || row.contract || undefined,
            segment: row.segment ? parseInt(row.segment) : undefined,
            message: row.mensagem || row.message || undefined, // Mensagem personalizada por contato
          });
        })
        .on("end", async () => {
          console.log(
            `✅ [Campaigns] CSV processado: ${contacts.length} contatos encontrados`
          );
          try {
            const result = await this.campaignsService.uploadCampaign(
              +id,
              contacts,
              message,
              useTemplate === "true",
              templateId ? parseInt(templateId) : undefined
            );
            console.log("✅ [Campaigns] Upload concluído:", result);
            resolve(result);
          } catch (error) {
            console.error("❌ [Campaigns] Erro no upload:", error.message);
            reject(error);
          }
        })
        .on("error", (error) => {
          console.error("❌ [Campaigns] Erro ao processar CSV:", error.message);
          reject(error);
        });
    });
  }

  @Get('summary')
  getSummaries(@Query('search') search?: string) {
    return this.campaignsService.getCampaignSummaries({ search });
  }

  @Get()
  @Roles(Role.admin, Role.supervisor, Role.digital)
  findAll() {
    return this.campaignsService.findAll();
  }

  @Get(":id")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  findOne(@Param("id") id: string) {
    return this.campaignsService.findOne(+id);
  }

  @Get("stats/:name")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  getStats(@Param("name") name: string) {
    return this.campaignsService.getStats(name);
  }

  @Get("next-messages/:name")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  getNextMessages(@Param("name") name: string) {
    return this.campaignsService.getNextMessages(name);
  }

  @Delete(":id")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  remove(@Param("id") id: string) {
    return this.campaignsService.remove(+id);
  }

  @Delete("by-name/:name")
  @Roles(Role.admin, Role.supervisor, Role.digital)
  removeByName(@Param("name") name: string) {
    return this.campaignsService.removeByName(name);
  }
}
