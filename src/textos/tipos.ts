/**
 * Os tipos de vídeo que a marca liga e desliga (E44 PR 2, desenho do passo 17: `Comecar`, `Briefing`, `Conta` e `AdminCliente`, estados `formatos`). Na tela a coisa se chama
 * "tipo de vídeo" (nunca "formato"); o nome e a frase de cada um dos treze vêm de `config/formatos.ts`.
 */
export const textosTipos = {
  /** O nome acessível da lista, e da folha da Conta. */
  rotuloLista: "Tipos de vídeo",
  tituloCartao: "Que tipos de vídeo combinam com você?",
  tituloBriefing: "Que tipos de vídeo combinam com você",
  explicaComecar:
    "É daqui que a gente escolhe os exemplos que você vê e o jeito de escrever os seus roteiros. Já deixamos ligado o que serve para quase todo negócio: confira e troque o que não for a sua cara. Dá para mudar depois, na Conta.",
  explicaBriefing: "É daqui que saem os exemplos que você vê e o jeito de escrever os seus roteiros. Cada troca vale a partir do próximo roteiro.",
  /** "9 ligados de 13" (a contagem em negrito, o resto em texto). */
  ligadosDe: (ligados: number, total: number) => ({ numero: String(ligados), resto: `ligados de ${total}` }),
  comoSugerimos: "como a gente sugere",
  trocados: (quantos: number) => (quantos === 1 ? "1 trocado por você" : `${quantos} trocados por você`),
  respondidoEm: (data: string) => `respondido em ${data}`,
  voceLigou: "você ligou",
  voceDesligou: "você desligou",
  porExemplo: "Por exemplo:",
  /** O pé do Começar, no lado da nota: os tipos não entram nela. */
  naoEntramNaNota: "Os tipos de vídeo não entram na nota.",
  /** Quando uma troca não grava (sem rede, sessão caída): a chave volta e a frase diz. */
  erro: "Não deu para guardar essa troca agora. Tente de novo em instantes.",
  conta: {
    titulo: "Tipos de vídeo",
    resumo: (ligados: number, total: number) => `${ligados} ligados de ${total}. De onde vêm os seus exemplos e roteiros.`,
    resumoDaFolha: "cada troca vale a partir do próximo roteiro",
    pronto: "Pronto",
  },
  admin: {
    titulo: "Tipos de vídeo",
    resumo: (ligados: number, total: number) => `${ligados} ligados de ${total}`,
    ajustados: (quantos: number) => (quantos === 1 ? "1 ajustado por você" : `${quantos} ajustados por você`),
    verEAjustar: "Ver e ajustar",
    tituloDaFolha: (marca: string) => `Tipos de vídeo de ${marca}`,
    explica: "O que você troca aqui vale por cima do que o cliente escolheu, e ele vê a chave como você deixou.",
    padrao: "Padrão",
    escolhidoPeloCliente: "Escolhido pelo cliente",
    ajustadoPorVoce: "Ajustado por você",
    clienteTinhaLigado: "o cliente tinha ligado",
    clienteTinhaDesligado: "o cliente tinha desligado",
    voltarAoDoCliente: "Voltar ao que o cliente escolheu",
    pronto: "Pronto",
  },
  /** O selo que o cartão de Referências mostra é só o nome do tipo; no roteiro, `seloDoTipo` ("Tipo: erro comum"). */
};
