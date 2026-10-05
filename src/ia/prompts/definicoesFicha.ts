/**
 * As cinco fichas que a extração recebe (E49 PR 2): a chave, o critério pelo que dá para observar no vídeo de outra pessoa e um exemplo de cada (a ficha do roteiro, `config/fichas.ts`, é
 * escrita para quem grava). "veja" é o resíduo, e a ordem de decisão vem junto.
 *
 * Revisão de 05/10/2026 (golden set de extração com chave: 9 de 18, puxando para "guardem"; meta 15 de 18): o critério de cada ficha ficou pelo que se vê (resultado entregue e preço para
 * "me_chamem", instrução reutilizável para "guardem", pergunta ou lista de erros para "comentem", cena que se reconhece para "mandem"), com a ordem de decisão e um exemplo por ficha; "guardem"
 * deixou de ser o padrão e "veja" é o valor da dúvida. Os exemplos são genéricos (não são os casos do golden set).
 */
/** A versão das definições (compartilhadas por `extrairVideo` e `extrairVideoSemFala`, que sobem junto): 1.1.0 na revisão de 05/10/2026. */
export const versao = "1.1.0";

export function definicoesFicha(): string {
  return [
    '  - "guardem": o vídeo ensina algo para usar depois: passo a passo, lista de dicas ou de jeitos, receita, modelo para copiar. Exemplo: "3 passos para tirar cheiro de fritura da cozinha". Não é "guardem" o antes e depois (é prova), a lista de erros (é discussão) nem o humor.',
    '  - "mandem": o vídeo é feito para ser mandado a alguém: uma cena do dia a dia, um hábito ou uma verdade que quem assiste reconhece na hora e quer mostrar para outra pessoa ("POV", "todo mundo que..."). Exemplo: "POV: a sogra passa o dedo no móvel".',
    '  - "comentem": o vídeo pede resposta: termina perguntando ou dividindo opinião ("qual você faz?", "concorda?"), é uma lista de erros ou um "nunca faça isso" em tom de alerta, ou responde a dúvida de um seguidor. Exemplo: "5 erros que estragam a cortina, qual você comete?"; "dá para lavar colcha de seda em casa?".',
    '  - "me_chamem": o vídeo é prova para vender: resultado entregue (antes e depois, trabalho pronto), serviço acontecendo, bastidor com preço ou orçamento, resposta a "quanto custa" ou "como contrato", convite claro para chamar ou comprar. Exemplo: "antes e depois da cortina lavada, orçamento no direct".',
    '  - "veja": o vídeo é feito para muita gente parar para ver (tendência, humor genérico, entretenimento do ramo) e não tem instrução reutilizável, nem pergunta, nem cena que se reconhece, nem venda; é o valor quando houver dúvida. Exemplo: "o dia mais caótico de uma lavanderia, em tom de brincadeira".',
    "",
    "  Como decidir, nesta ordem: (1) mostra resultado entregue, preço ou orçamento: me_chamem, mesmo que também ensine algo; (2) tem instrução reutilizável de verdade (passos, lista de dicas, receita) e não é antes e depois: guardem; lista de erros não é guardem; (3) termina pedindo opinião, pergunta ou responde dúvida de seguidor: comentem; (4) retrata uma cena que se reconhece: mandem; (5) senão: veja. Nunca use guardem por padrão.",
  ].join("\n");
}
