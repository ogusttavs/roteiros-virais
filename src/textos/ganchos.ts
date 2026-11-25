import type { EmocaoDoGancho, TipoAbertura } from "@/db/schema";
import type { MotivoDosGanchos } from "@/servicos/ganchos-alternativos";

/**
 * Os ganchos alternativos do roteiro (25/11/2026): o botao "Outros ganchos", a lista e as frases de falha. Linguagem de quem dirige um negocio pequeno, sem jargao: o tipo de abertura e a emocao
 * aparecem em palavras de gente, nunca com o nome do enum.
 */
export const ROTULO_DO_TIPO_DE_ABERTURA: Record<TipoAbertura, string> = {
  cena: "Mostra uma cena",
  resultado: "Começa pelo resultado",
  objeto: "Começa por um objeto",
  fala_direta: "Fala direto para a câmera",
  numero: "Começa com um número",
  contraste: "Antes e depois",
  pergunta: "Começa com uma pergunta",
  outro: "Outro jeito",
};

export const ROTULO_DA_EMOCAO: Record<EmocaoDoGancho, string> = {
  curiosidade: "Curiosidade",
  espanto: "Espanto",
  graca: "Graça",
  identificacao: "Identificação",
  alerta: "Alerta",
  desejo: "Desejo",
  saudade: "Saudade",
  indignacao: "Revolta com o problema",
};

export const textosGanchos = {
  titulo: "Outros ganchos",
  ajuda: "O gancho é o começo do vídeo, os primeiros três segundos. Veja outros jeitos de abrir este mesmo vídeo e troque com um toque. Depois de postar, o app mostra qual abertura rendeu mais.",
  botao: "Outros ganchos",
  botaoAbrir: "Ver os outros ganchos",
  botaoFechar: "Fechar",
  escrevendo: "Escrevendo outros jeitos de abrir o vídeo...",
  atual: "No roteiro agora",
  usar: "Usar este gancho",
  usando: "Está no roteiro",
  voltar: "Voltar ao gancho de antes",
  trocou: "Pronto, o gancho do roteiro mudou.",
  voltou: "Pronto, voltamos ao gancho de antes.",
  deAntes: "O gancho de antes",
  aviso: {
    verComo: "Você está vendo como a marca. Aqui só dá para olhar, quem troca o gancho é o dono da conta.",
    fechado: "O roteiro já foi gravado, então o gancho não muda mais.",
  },
  frases: {
    "nao-achou": "Não achamos este roteiro. Volte para o Hoje e abra de novo.",
    "sem-gancho": "Este roteiro não tem um gancho para trocar.",
    "ja-gravado": "Este roteiro já foi gravado, então o gancho não muda mais.",
    "sem-briefing": "Falta terminar o briefing para escrever outros ganchos.",
    "limite-do-dia": "Você já pediu muitos ganchos hoje. Tente de novo amanhã.",
    "ia-fora": "Não deu para escrever outros ganchos agora. O seu roteiro continua como está. Tente de novo em instantes.",
    "em-andamento": "Já tem uma lista de ganchos sendo escrita para esta marca. Espere ficar pronta.",
    indisponivel: "Estamos escrevendo vários textos agora. Tente de novo em instantes.",
    "escolha-invalida": "Esse gancho não está na lista. Atualize a tela e escolha de novo.",
    "sem-alternativas": "Peça os outros ganchos primeiro.",
  } satisfies Record<MotivoDosGanchos, string>,
  semConexao: "Sem conexão. Tente de novo quando voltar.",
  falhaGenerica: "Não foi possível agora. Tente de novo em instantes.",
};

export function fraseDosGanchos(motivo: MotivoDosGanchos): string {
  return textosGanchos.frases[motivo];
}
