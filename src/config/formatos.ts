/**
 * Os formatos de vídeo (E44, `pesquisa/estudo-formatos.md`, seção 4, aprovada pelo Gustavo em 02/10/2026): as treze chaves que o cliente responde no briefing
 * (cada uma com a frase como ele a lê e o padrão com que nasce) mais os valores que a análise do vídeo pode dar e que nunca servem de modelo para marca nenhuma.
 * A chave é o que o banco guarda (`videos.formato_catalogo`, `formatos_da_marca.chave`); o nome e a frase são o que a pessoa lê, sem jargão.
 */

export type FormatoDoCatalogo = {
  chave: string;
  /** Como o cliente lê o nome. */
  nome: string;
  /** A frase para o cliente (e a definição de uma frase que a análise do vídeo recebe). */
  frase: string;
  /** Como a chave nasce antes de o cliente responder. */
  /** O exemplo de tela: uma frase fixa por tipo, igual para todas as marcas (desenho do passo 17: "Por exemplo: ..."). */
  exemplo: string;
  ligadaPorPadrao: boolean;
};

export const FORMATOS_DO_CATALOGO: readonly FormatoDoCatalogo[] = [
  { chave: "passo_a_passo", nome: "Passo a passo", frase: "Você ensina a fazer alguma coisa, do começo ao resultado.", exemplo: "como tirar mancha de café do sofá em três passos.", ligadaPorPadrao: true },
  { chave: "antes_e_depois", nome: "Antes e depois", frase: "Você mostra como estava e como ficou.", exemplo: "o tapete da sala antes e depois de 20 minutos.", ligadaPorPadrao: true },
  { chave: "produto_em_uso", nome: "O produto ou serviço em uso", frase: "Você mostra o que vende funcionando, num caso de verdade.", exemplo: "o removedor numa mancha de vinho de ontem.", ligadaPorPadrao: true },
  { chave: "erro_comum", nome: "Erro comum", frase: "Você mostra o jeito errado que muita gente faz e o jeito certo.", exemplo: "por que a mancha volta depois da limpeza.", ligadaPorPadrao: true },
  { chave: "lista", nome: "Lista", frase: "Três jeitos, cinco dicas, sete erros: uma contagem.", exemplo: "cinco coisas da casa que você limpa errado.", ligadaPorPadrao: true },
  { chave: "bastidor", nome: "Bastidor", frase: "O trabalho acontecendo, o seu dia, o que ninguém vê.", exemplo: "um dia separando e mandando os pedidos.", ligadaPorPadrao: true },
  { chave: "minha_historia", nome: "A sua história", frase: "De onde você veio, o que deu errado, o que aprendeu.", exemplo: "como a loja começou na garagem de casa.", ligadaPorPadrao: true },
  { chave: "historia_de_outra_empresa", nome: "História de outra empresa", frase: "Você conta um caso conhecido e tira a lição para o seu público.", exemplo: "como uma marca de sabão virou a mais vendida do país.", ligadaPorPadrao: false },
  { chave: "opiniao_direta", nome: "Opinião direta", frase: "Você fala o que pensa, sem rodeio, olhando para a câmera.", exemplo: "produto caro não limpa melhor, e você explica por quê.", ligadaPorPadrao: false },
  { chave: "teste_ou_desafio", nome: "Teste ou desafio", frase: "Você faz uma experiência e mostra o resultado no fim.", exemplo: "três receitas caseiras na mesma mancha.", ligadaPorPadrao: false },
  {
    chave: "respondendo_pergunta",
    nome: "Respondendo pergunta ou caixinha",
    frase: "Você responde uma dúvida de cliente, de comentário ou da caixinha.",
    exemplo: "“vinagre estraga o rejunte?”", ligadaPorPadrao: true,
  },
  { chave: "cena_encenada", nome: "Cena encenada", frase: "Um teatrinho curto, com personagens, para mostrar uma situação.", exemplo: "a visita avisa que chega em dez minutos.", ligadaPorPadrao: false },
  { chave: "humor_e_meme", nome: "Humor e meme", frase: "A sua versão de uma brincadeira que está circulando.", exemplo: "a brincadeira da semana, com o seu sofá.", ligadaPorPadrao: false },
];

export const CHAVES_DE_FORMATO = FORMATOS_DO_CATALOGO.map((f) => f.chave);

/**
 * O que a análise pode dar e que o cliente nunca escolhe: o vídeo é classificado assim e nunca serve de modelo (os dois "sem fala" seguem pela régua do setor e
 * pelo roteiro do vídeo sem fala, M4; o resto, para marca nenhuma).
 */
export const FORMATOS_FORA_DO_CATALOGO = [
  { chave: "sem_fala_processo", frase: "Vídeo sem ninguém falando, que mostra o trabalho sendo feito." },
  { chave: "sem_fala_resultado", frase: "Vídeo sem ninguém falando, que mostra só o resultado pronto." },
  { chave: "noticia_comentada", frase: "Uma notícia ou um dado do momento comentado." },
  { chave: "recorte_de_outro", frase: "Um pedaço de vídeo de outra pessoa, reaproveitado." },
  { chave: "ao_vivo_ou_podcast", frase: "Transmissão ao vivo ou podcast longo cortado." },
  { chave: "outro", frase: "Nada do que está acima descreve bem o vídeo." },
] as const;

/** Os dois "sem fala": passam pela régua do setor e não pelas chaves do cliente. */
export const FORMATOS_SEM_FALA: readonly string[] = ["sem_fala_processo", "sem_fala_resultado"];

/** Tudo o que a análise de um vídeo pode guardar em `videos.formato_catalogo`. */
export const FORMATOS_DO_VIDEO = [...CHAVES_DE_FORMATO, ...FORMATOS_FORA_DO_CATALOGO.map((f) => f.chave)] as [string, ...string[]];

export function formatoPorChave(chave: string | null | undefined): FormatoDoCatalogo | null {
  return FORMATOS_DO_CATALOGO.find((f) => f.chave === chave) ?? null;
}

/** As chaves que nascem ligadas (o padrão do estudo): as oito de uma marca que ainda não respondeu. */
export const CHAVES_LIGADAS_POR_PADRAO = FORMATOS_DO_CATALOGO.filter((f) => f.ligadaPorPadrao).map((f) => f.chave);

/**
 * O que a pessoa lê (E44, decisão do Fable de 04/10): na tela e nos textos a coisa se chama "tipo de vídeo" e o selo é "Tipo: erro comum", nunca "formato"; por dentro
 * o nome do banco continua `formato_catalogo`/`formatos_da_marca`. O exemplo de cada tipo é uma frase fixa por tipo, igual para todas as marcas (as treze do
 * desenho do passo 17, `exemplo` em `FORMATOS_DO_CATALOGO`), reunidas aqui pela chave.
 */
export const EXEMPLO_DO_TIPO: Readonly<Record<string, string>> = Object.fromEntries(FORMATOS_DO_CATALOGO.map((f) => [f.chave, f.exemplo]));

/** O selo que o cartão mostra: "Tipo: erro comum" (o nome do tipo em minúscula, depois de "Tipo:"). Vazio para o que não é uma das treze (nunca aparece para o cliente). */
export function seloDoTipo(chave: string | null | undefined): string | null {
  const formato = formatoPorChave(chave);
  if (!formato) return null;
  return `Tipo: ${formato.nome.charAt(0).toLowerCase()}${formato.nome.slice(1)}`;
}
