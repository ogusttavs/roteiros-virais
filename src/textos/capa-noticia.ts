import { CAMPOS_DO_TIPO } from "@/config/carrossel";

const LIMITE = CAMPOS_DO_TIPO.noticia.titulo!;

/**
 * Os textos da capa de notícia (E66, `/criar/capa`, só com `CARROSSEL_ATIVO` ligada). O desenho não tem tela própria para a capa: ela usa as peças da tela "Criar carrossel" (`textos/carrossel.ts`) e
 * estes textos só dizem o que é da capa. Linguagem de quem tem um pequeno negócio: nada de jargão.
 */
export const textosCapa = {
  // O botão em Notícias
  botao: "Criar capa com esta notícia",

  // O topo
  tituloCompacto: "Capa de notícia",
  voltar: "Voltar para Notícias",
  data: "Capa de notícia · uma imagem",
  titulo: "Faça a capa desta notícia",
  subtitulo: "Uma imagem para o Instagram, com o título, o jornal e o dia da notícia, e a sua foto.",
  daNoticia: "A notícia",
  veiculoData: (veiculo: string, data: string) => `${veiculo}, ${data}`,

  // Os títulos
  buscandoTitulo: "Escrevendo os títulos",
  buscandoAjuda: "A gente lê a notícia e escreve de 3 a 5 títulos com a cara da sua marca. Leva cerca de 20 segundos.",
  etapaLendo: "Lendo a notícia",
  etapaEscrevendo: "Escrevendo os títulos",
  etapaConferindo: "Conferindo que não tem número nem fato que a notícia não traz",
  escolherTitulo: "Escolha o título da capa",
  tituloAria: "Os títulos que a gente escreveu",
  escreverTitulo: "O título da capa",
  escreverTituloAjuda: "Você pode mexer no título escolhido ou escrever o seu.",
  contagemPalavras: (usadas: number) => `${usadas} de ${LIMITE.palavras} palavras`,
  contagemCaracteres: (usados: number) => `${usados} de ${LIMITE.caracteres} caracteres`,
  passouPalavras: (n: number) => `Passou ${n} ${n === 1 ? "palavra" : "palavras"}. Encurte para caber.`,
  passouCaracteres: (n: number) => `Passou ${n} caracteres. Encurte para caber.`,
  novosTitulos: "Escrever outros títulos",
  semTitulosAgora: "Não deu para escrever os títulos agora. Você pode escrever o seu abaixo, ou tentar de novo.",
  tituloVazio: "Escreva ou escolha um título.",

  // A foto
  fotoTitulo: "A sua foto",
  fotoAjuda: "O seu lugar, o seu produto, o seu trabalho. Nunca a foto do jornal: ela é deles, e a gente não usa.",
  fotoSemFoto: "Sem foto, a capa sai com a cor da sua marca no lugar dela.",
  mandarFoto: "Mandar uma foto",
  trocarFoto: "Trocar a foto",
  porFoto: "Pôr uma foto",
  tirarFoto: "Tirar a foto",
  fotoDaCapa: "A foto da capa",
  fotoSoUma: "A capa leva uma foto só.",

  // Criar
  criar: "Criar a capa",
  criarAjuda: "Sem esperar: a capa fica pronta em instantes.",

  // Montando
  montandoTitulo: "Montando a sua capa",
  montandoAjuda: "Fique nesta tela até ela ficar pronta.",
  etapaMontando: "Colocando o título, o jornal e o dia",
  etapaFoto: (comFoto: boolean) => (comFoto ? "Encaixando a sua foto e a cor da marca" : "Colocando a cor da marca"),

  // Pronto
  prontoData: "Pronto · uma imagem",
  prontoTitulo: "A sua capa está pronta",
  prontoAjuda: "Confira a imagem. Dá para mudar o título e a foto antes de postar.",
  capaAria: "A capa pronta",
  baixar: "Baixar a imagem",
  baixando: "Preparando a imagem...",
  prepararParaCelular: "Preparar a imagem para o celular",
  salvarNoCelular: "Salvar a imagem no celular",
  baixarAjuda: "No celular, ela vai para a sua galeria. Depois é só postar. A gente não posta nada sem você.",
  baixarFalhou: "Não deu para baixar agora. Tente de novo em instantes.",
  mudarTitulo: "Mudar o título",
  salvarTitulo: "Salvar o título",
  salvando: "Salvando...",
  legendaRotulo: "A legenda",
  legendaAjuda: "Já leva o nome do jornal e o dia, para ninguém achar que a notícia é sua.",
  copiarLegenda: "Copiar a legenda",
  legendaCopiada: "Legenda copiada",
  fazerOutra: "Fazer outra capa",
  previaFalhou: "Não deu para montar a imagem agora.",
  tentarDeNovo: "Tentar de novo",
  falhouAoSalvar: "Não deu para salvar agora. Tente de novo.",

  abrindoTitulo: "Abrindo a sua capa",
  abrirFalhouTitulo: "Não deu para abrir a capa",
  abrirFalhouAjuda: "Ela continua guardada. Tente de novo em instantes.",

  // Erro e limite
  erroRotulo: "Não deu certo",
  erroTitulo: "A capa não ficou pronta",
  erroAjuda: "Tivemos um problema ao montar a capa. O seu título e a sua foto continuam aqui.",
  limiteTitulo: "Não dá para criar mais capas agora",
  limiteAjuda: "As capas que você já fez continuam aqui para baixar.",
  verOpcoes: "Ver as opções",
  agoraNao: "Agora não",
} as const;
