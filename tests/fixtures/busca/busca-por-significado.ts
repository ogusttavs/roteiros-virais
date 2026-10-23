/**
 * Banco de brinquedo da busca por significado (E17 parte 1, 23/10/2026): um setor de odontologia com 18 vídeos inventados e 10 temas de exemplo, cada um com o que
 * a busca de sempre acha (`antes`) e o primeiro que a busca por significado acha (`primeiro`), em chaves de vídeo. Usado pelo teste de integração e pelo script de comparação
 * (`scripts/comparar-busca-por-significado.ts`), para o PR mostrar os dois lados com os mesmos dados. Nenhum dado real.
 */
import { db } from "@/db";
import { videos } from "@/db/schema";

export type VideoDeBusca = {
  chave: string;
  titulo: string;
  assunto: string;
  transcricao?: string;
  etiquetas?: string[];
  foraDaCurva: number;
};

export const VIDEOS_DE_BUSCA: VideoDeBusca[] = [
  { chave: "clareamento", titulo: "Clareamento dental vale a pena? Antes e depois", assunto: "resultado do clareamento dental", transcricao: "o clareamento com gel e luz deixa o sorriso mais branco em poucas sessoes", foraDaCurva: 9 },
  { chave: "implante", titulo: "Implante dentário: quanto custa e quanto dura", assunto: "custo do implante dentário", transcricao: "o implante é um pino de titanio que substitui a raiz do dente perdido", foraDaCurva: 8 },
  { chave: "aparelho", titulo: "Aparelho invisível funciona mesmo?", assunto: "alinhadores transparentes", transcricao: "os alinhadores movem os dentes aos poucos sem brackets metalicos", foraDaCurva: 7 },
  { chave: "canal", titulo: "Tratamento de canal dói? A verdade", assunto: "dor no tratamento de canal", transcricao: "com anestesia o tratamento de canal nao dói e salva o dente", foraDaCurva: 7 },
  { chave: "sensibilidade", titulo: "Dente sensível ao gelado: o que fazer", assunto: "sensibilidade nos dentes ao frio", transcricao: "a dentina exposta faz o dente doer com sorvete e agua gelada", foraDaCurva: 6 },
  { chave: "halito", titulo: "Mau hálito: as 3 causas que ninguém conta", assunto: "causas do mau hálito", transcricao: "a lingua saburrosa e a principal causa do halito pesado", foraDaCurva: 6 },
  { chave: "crianca", titulo: "Primeira consulta do bebê no dentista", assunto: "levar crianças ao dentista cedo", transcricao: "a primeira visita deve ser logo que nasce o primeiro dentinho", foraDaCurva: 5 },
  { chave: "fio", titulo: "Fio dental: você usa do jeito errado", assunto: "como usar o fio dental", transcricao: "passe o fio em forma de c ao redor de cada dente", foraDaCurva: 5 },
  { chave: "escovacao", titulo: "Escovar os dentes logo depois de comer?", assunto: "hora certa de escovar os dentes", transcricao: "espere meia hora depois de comer algo acido antes de escovar", foraDaCurva: 4 },
  { chave: "gengiva", titulo: "Gengiva sangrando? Não ignore", assunto: "sangramento da gengiva", transcricao: "gengiva que sangra ao escovar e sinal de inflamacao", foraDaCurva: 6 },
  { chave: "siso", titulo: "Extração do siso: como é a recuperação", assunto: "recuperação da cirurgia do siso", transcricao: "gelo nas primeiras horas e comida fria ajudam na cicatrizacao", foraDaCurva: 4 },
  { chave: "cafe", titulo: "Café mancha o dente? Dá para evitar", assunto: "manchas por café e vinho nos dentes", transcricao: "bebidas escuras deixam pigmento no esmalte", etiquetas: ["manchas"], foraDaCurva: 5 },
  { chave: "lentes", titulo: "Lentes de porcelana: vale a pena", assunto: "lentes de contato dental", transcricao: "laminas finas coladas na frente do dente mudam o formato do sorriso", foraDaCurva: 5 },
  { chave: "bruxismo", titulo: "Range os dentes dormindo? Pode ser bruxismo", assunto: "bruxismo e dor na mandíbula", transcricao: "a placa miorrelaxante protege o esmalte durante a noite", foraDaCurva: 6 },
  { chave: "ortodontia", titulo: "Ortodontia para adultos: vale a pena", assunto: "tratamento ortodôntico na vida adulta", transcricao: "nunca e tarde para alinhar os dentes", foraDaCurva: 4 },
  { chave: "pilates", titulo: "Pilates para adultos: por onde começar", assunto: "primeiras aulas de pilates", transcricao: "comece com duas aulas por semana", foraDaCurva: 4 },
  { chave: "bolo", titulo: "Receita de bolo de cenoura com cobertura", assunto: "receita de bolo", transcricao: "misture a cenoura com ovos e oleo no liquidificador", foraDaCurva: 12 },
  { chave: "consultorio", titulo: "Como organizar a agenda do consultório", assunto: "organização da agenda do consultório", transcricao: "bloqueie horarios para emergencias e confirme as consultas", foraDaCurva: 3 },
];

export type TemaDeComparacao = {
  tema: string;
  /** O que a busca de sempre acha (chaves), na ordem. */
  antes: string[];
  /** O primeiro que a busca por significado acha; `null` quando ela continua sem achar nada. Quem já era achado continua sendo. */
  primeiro: string | null;
  /** Por que muda (ou não). */
  nota: string;
};

export const TEMAS_DE_COMPARACAO: TemaDeComparacao[] = [
  { tema: "clarear os dentes", antes: [], primeiro: "clareamento", nota: "grafia parecida (clarear e clareamento); \"dentes\" é palavra do setor e vale meio ponto" },
  { tema: "hálito ruim", antes: [], primeiro: "halito", nota: "uma palavra basta num tema de duas; a outra nenhum vídeo tem" },
  { tema: "aparelho invisivel", antes: [], primeiro: "aparelho", nota: "sem acento no tema, com acento no vídeo" },
  { tema: "ranger os dentes de noite", antes: ["bruxismo"], primeiro: "bruxismo", nota: "já achava (todas as palavras estavam no vídeo); continua igual" },
  { tema: "dor de dente quando bebo gelado", antes: [], primeiro: "sensibilidade", nota: "falta uma palavra no vídeo e a de antes exigia todas; o vídeo que escreve \"dente\" e \"gelado\" vem na frente" },
  { tema: "gengiva sangrando ao escovar", antes: ["gengiva"], primeiro: "gengiva", nota: "já achava; continua igual" },
  { tema: "quanto custa implante dentario", antes: [], primeiro: "implante", nota: "sem acento no tema, com acento no vídeo" },
  { tema: "como tirar mancha de vinho dos dentes", antes: ["cafe"], primeiro: "cafe", nota: "já achava pela etiqueta; continua igual, sem puxar os outros vídeos de dente" },
  { tema: "tratamento de canal doi", antes: [], primeiro: "canal", nota: "\"doi\" sem acento impedia o casamento de todas as palavras" },
  { tema: "meu filho tem medo de dentista", antes: [], primeiro: null, nota: "o vídeo certo (crianças no dentista) não divide palavra com o tema: é para o modelo barato" },
];

/** Semeia os vídeos num setor e devolve a chave de cada um para o id. Vistos e views acima de qualquer piso; publicados há 10 dias. */
export async function semearBuscaPorSignificado(nichoId: number, prefixo: string): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const v of VIDEOS_DE_BUSCA) {
    const [linha] = await db()
      .insert(videos)
      .values({
        plataforma: "youtube",
        idExterno: `${prefixo}-${v.chave}`,
        url: `https://exemplo.invalido/${prefixo}-${v.chave}`,
        nichoId,
        titulo: v.titulo,
        transcricao: v.transcricao,
        etiquetas: v.etiquetas ?? [],
        views: 200000,
        foraDaCurva: String(v.foraDaCurva),
        publicadoEm: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        idioma: "pt",
        analise: {
          assunto: v.assunto,
          gancho: `gancho de ${v.chave}`,
          estrutura: "estrutura",
          fechamento: "fechamento",
          chamadaFinal: "chamada",
          formato: "fala_para_camera",
          porQueFuncionou: "x",
        } as never,
      })
      .returning({ id: videos.id });
    ids.set(v.chave, linha.id);
  }
  return ids;
}
