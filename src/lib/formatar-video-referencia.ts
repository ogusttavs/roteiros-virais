/**
 * Como um vídeo de referência vira o que a tela mostra (`VideoFormatado`): o cartão e a folha de detalhes de Referências, e agora também os "Exemplos que fazem isso" do passo do objetivo no
 * Criar (hotfix de 22/10/2026), que abrem a mesma prévia sem sair do passo. Só texto e números prontos, sem nada de navegador, para a Server Action poder montar.
 */
import { NOME_CURTO_DA_FICHA } from "@/config/fichas";
import { formatoPorChave } from "@/config/formatos";
import type { Plataforma } from "@/db/schema";
import { classificarMultiplo, formatarMultiplo, rotuloMultiploConta } from "@/lib/formatarNumero";
import type { VideoReferencia } from "@/servicos/pesquisa";
import { textosReferencias } from "@/textos/referencias";
import type { VideoFormatado } from "@/ui/componentes/ReferenciaCartao";

export const ROTULO_PLATAFORMA: Record<Plataforma, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

export const FORMATAR_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

export function formatarVideo(v: VideoReferencia, nomesDosAlternativos: Map<number, string>): VideoFormatado {
  const faixa = classificarMultiplo(v.foraDaCurva);
  return {
    id: v.id,
    url: v.url,
    plataforma: v.plataforma,
    multiplo: formatarMultiplo(v.foraDaCurva),
    rotuloMultiplo: rotuloMultiploConta(faixa, v.contaMedianaOrigem),
    faixaMultiplo: faixa,
    views: v.views,
    medianaConta: v.medianaConta,
    velocidade: v.velocidade,
    contaNome: v.contaNome ?? v.contaHandle ?? textosReferencias.contaNaoIdentificada,
    plataformaData: v.publicadoEm
      ? `${ROTULO_PLATAFORMA[v.plataforma]}, ${FORMATAR_DATA.format(v.publicadoEm)}`
      : ROTULO_PLATAFORMA[v.plataforma],
    titulo: v.titulo,
    assunto: v.assunto,
    gancho: v.gancho,
    estrutura: v.estrutura,
    porQueFuncionou: v.porQueFuncionou,
    capaUrl: v.capaUrl,
    semFala: v.semFala === true,
    segundoChave: v.segundoChave,
    abaixoDaRegua: v.abaixoDaRegua,
    tipoConteudo: v.tipoConteudo,
    ramoNome: v.nichoId === null ? undefined : nomesDosAlternativos.get(v.nichoId),
    // E44 PR 2: o tipo de vídeo, só para os treze do cliente (recorte de outro, notícia, ao vivo e "outro" não ganham selo).
    tipoDeVideo: formatoPorChave(v.formatoCatalogo)?.nome,
    feitoPara: v.fichaCatalogo ? NOME_CURTO_DA_FICHA[v.fichaCatalogo] : undefined,
  };
}

/**
 * A legenda do post sem as hashtags (hotfix de 22/10/2026: o título de um vídeo do Instagram ou do TikTok é a legenda inteira, "o passo a passo que todo mundo salva #limpeza #dica"). Tira cada
 * "#palavra" e arruma o espaço; se sobrar nada (a legenda era só hashtag), devolve o texto de reserva.
 */
export function legendaSemHashtags(legenda: string | null | undefined, reserva = ""): string {
  const limpa = (legenda ?? "")
    .replace(/(^|\s)#[^\s#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return limpa || reserva;
}
