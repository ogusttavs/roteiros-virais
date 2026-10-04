/**
 * As cinco fichas que a extração recebe (E49 PR 2): a chave e a definição de uma frase de cada uma, em terceira pessoa e pelo que dá para observar no vídeo de outra pessoa
 * (a ficha do roteiro, `config/fichas.ts`, é escrita para quem grava). "veja" é o resíduo: o que não tem sinal claro das outras quatro.
 */
export function definicoesFicha(): string {
  return [
    '  - "guardem": o vídeo ensina algo para usar depois: passo a passo, lista, receita, modelo para copiar, o método por trás de um antes e depois.',
    '  - "mandem": o vídeo é feito para ser mandado a alguém: uma situação, um hábito ou uma verdade que quem assiste reconhece na hora e quer mostrar para outra pessoa.',
    '  - "comentem": o vídeo pede resposta: uma opinião que divide, um erro comum com pergunta, uma pergunta aberta ao público.',
    '  - "me_chamem": o vídeo é prova para vender: resultado de verdade, trabalho acontecendo, bastidor com preço, convite claro para chamar ou comprar.',
    '  - "veja": o vídeo é feito para muita gente parar para ver (um assunto em alta, um começo forte, entretenimento do ramo) e não se encaixa com clareza nas outras quatro; é o valor quando houver dúvida.',
  ].join("\n");
}
