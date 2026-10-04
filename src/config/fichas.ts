import type { Ficha, Objetivo } from "@/db/schema";

export type { Ficha };

/**
 * As cinco fichas do "O que você quer que esse vídeo faça?" (E49 PR 1, passo 18 do Opus): só para Reels, TikTok e Shorts. O Story não pergunta. Por baixo, cada ficha conta
 * em um dos três objetivos de sempre (`roteiros.objetivo`, do tema, do plano): "veja" e "mandem" em mais gente te conhecer, "guardem" e "comentem" em lembrarem de você,
 * "me chamem" em te chamarem para comprar (dúvida 2 do passo 18). Os nomes internos do objetivo ficam aqui, fora do que a pessoa lê.
 */
export const FICHAS_EM_ORDEM: Ficha[] = ["veja", "guardem", "mandem", "comentem", "me_chamem"];

export function ehFicha(valor: unknown): valor is Ficha {
  return typeof valor === "string" && (FICHAS_EM_ORDEM as string[]).includes(valor);
}

const OBJETIVO_DA_FICHA: Record<Ficha, Objetivo> = {
  veja: "alcance",
  mandem: "alcance",
  guardem: "engajamento",
  comentem: "engajamento",
  me_chamem: "conversao",
};

export function objetivoDaFicha(ficha: Ficha): Objetivo {
  return OBJETIVO_DA_FICHA[ficha];
}

/** A ficha que representa um objetivo quando a pessoa não escolheu uma (tema do dia, plano, roteiro de antes das fichas). */
const FICHA_PADRAO: Record<Objetivo, Ficha> = { alcance: "veja", engajamento: "guardem", conversao: "me_chamem" };

export function fichaPadraoDoObjetivo(objetivo: Objetivo): Ficha {
  return FICHA_PADRAO[objetivo];
}

/** O que a pessoa lê em cada ficha: o nome, o que o vídeo vira, um exemplo neutro e em que o objetivo antigo ela ajuda. */
export const NOME_DA_FICHA: Record<Ficha, string> = {
  veja: "Que muita gente veja",
  guardem: "Que guardem para depois",
  mandem: "Que mandem para alguém",
  comentem: "Que comentem",
  me_chamem: "Que me chamem",
};

export const FRASE_DA_FICHA: Record<Ficha, string> = {
  veja: "Um começo que segura qualquer um e um assunto do momento, com o seu ramo no meio.",
  guardem: "Um passo a passo, uma lista ou o jeito por trás do antes e depois: algo para usar mais tarde.",
  mandem: "Aquilo que a pessoa reconhece na hora e manda para quem precisa ver.",
  comentem: "Uma opinião que divide, um erro comum ou uma pergunta que pede resposta.",
  me_chamem: "A prova: o resultado de verdade, o trabalho acontecendo, quanto custa.",
};

export const EXEMPLO_DA_FICHA: Record<Ficha, string> = {
  veja: "o problema que todo mundo do seu ramo conhece e quase ninguém resolve direito.",
  guardem: "os três passos, na ordem certa, para o resultado durar.",
  mandem: "para aquela pessoa que faz do jeito mais difícil.",
  comentem: "o que você vê todo dia e muita gente discorda.",
  me_chamem: "o trabalho de ontem, antes e depois, e quanto custou.",
};

export const AJUDA_EM_DA_FICHA: Record<Ficha, string> = {
  veja: "mais gente te conhecer",
  guardem: "lembrarem de você",
  mandem: "mais gente te conhecer",
  comentem: "lembrarem de você",
  me_chamem: "te chamarem para comprar",
};

/** O rótulo curto ("Para que ...") que o roteiro, o Hoje, o Planejar e o Meu plano mostram no lugar do objetivo antigo. */
export const ROTULO_PARA_QUE: Record<Ficha, string> = {
  veja: "Para que muita gente veja",
  guardem: "Para que guardem para depois",
  mandem: "Para que mandem para alguém",
  comentem: "Para que comentem",
  me_chamem: "Para que te chamem",
};

/** O que vem depois de "Continua sendo para que:" na folha de reprovar, e no Histórico em minúscula. */
export const COMPLEMENTO_PARA_QUE: Record<Ficha, string> = {
  veja: "muita gente veja",
  guardem: "guardem para depois",
  mandem: "mandem para alguém",
  comentem: "comentem",
  me_chamem: "te chamem",
};

export function fichaDoRoteiro(roteiro: { ficha?: Ficha | null; objetivo: Objetivo }): Ficha {
  return roteiro.ficha ?? fichaPadraoDoObjetivo(roteiro.objetivo);
}

/**
 * A estrutura que o roteiro segue em cada ficha (entra no pedido ao modelo, `prompts/roteiro.ts`). Fica aqui, fora de `prompts/`, porque os nomes dos objetivos que ela cita
 * coincidem com jargão que o `checar-texto` proíbe no que o cliente lê; esta frase é do pedido ao modelo, não da tela.
 */
export const ESTRUTURA_DA_FICHA: Record<Ficha, string> = {
  veja:
    "Que muita gente veja: o gancho precisa segurar qualquer pessoa nos primeiros três segundos, o assunto é o que está em alta agora, e o vídeo é feito para ser mandado para os amigos. O ramo da pessoa fica no meio do assunto: nunca entretenimento solto.",
  guardem:
    "Que guardem para depois: o corpo é algo para usar mais tarde, em passos numerados, uma lista, uma receita, um modelo para copiar ou o antes e depois com o método. Diga no começo que vale guardar, e feche pedindo para guardar. O ramo da pessoa é o centro: nunca entretenimento solto.",
  mandem:
    "Que mandem para alguém: o vídeo é de identificação, algo que a pessoa reconhece na hora (a situação, o hábito, a verdade incômoda) e manda para quem precisa ver. Feche com uma frase do tipo 'manda para quem precisa ver isso'. O ramo da pessoa fica no meio: nunca entretenimento solto.",
  comentem:
    "Que comentem: abra com uma opinião que divide, um erro comum ou uma pergunta aberta, e feche pedindo uma resposta específica nos comentários (não 'comenta aí'). O ramo da pessoa é o assunto: nunca entretenimento solto.",
  me_chamem:
    "Que me chamem: o corpo é a prova, o resultado de verdade, o trabalho acontecendo, o bastidor ou o preço, com dado concreto. Feche com um convite claro para chamar (direct, link ou mensagem). O ramo da pessoa é o centro: nunca entretenimento solto.",
};

/** "Com quem já segue": o que o Story mostra no lugar da ficha (ele não pergunta para que é o vídeo). */
export const ROTULO_STORY_PARA_QUEM = "Com quem já segue";

/**
 * O rótulo que a tela mostra de um item: a ficha dele quando tem, senão a ficha padrão do objetivo; um Story mostra "Com quem já segue". Os roteiros de antes das fichas e os itens do
 * plano (que só guardam o objetivo) caem na ficha padrão.
 */
export function rotuloParaQue(item: { ficha?: Ficha | null; objetivo: Objetivo; formato?: "reels" | "story" }): string {
  if (item.formato === "story") return ROTULO_STORY_PARA_QUEM;
  return ROTULO_PARA_QUE[fichaDoRoteiro(item)];
}

/** O objetivo que se grava num Story (ele não pergunta para que é o vídeo): falar com quem já segue. */
export const OBJETIVO_DO_STORY: Objetivo = "engajamento";
