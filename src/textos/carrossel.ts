/**
 * Os textos da tela "Criar carrossel" (E65 PR 2, `/criar/carrossel`, só com `CARROSSEL_ATIVO` ligada). Vêm da seção "Os textos da tela" do desenho (`entregaveis/design-v2/entrega/carrossel/README.md`),
 * com as trocas que a verdade do código pede: sem a contagem "neste mês" (o limite por mês é a E64, ainda não existe), sem "ele fica em Hoje" (o carrossel não aparece em Hoje), e o estado do limite
 * fala do teste e da assinatura, que é o teto que existe. Linguagem de quem tem um pequeno negócio: nada de jargão.
 */
export const textosCarrossel = {
  // A entrada, em Criar
  porta: { titulo: "Carrossel", ajuda: "Slides que ensinam, com o texto pronto e as suas fotos, para arrastar no Instagram." },

  // O topo
  tituloCompacto: "Carrossel",
  voltar: "Voltar para Criar",
  data: "Carrossel · imagens para arrastar",
  titulo: "Monte o seu carrossel",
  subtitulo: "Slides que ensinam, com o texto pronto e as suas fotos, do tamanho certo para o Instagram.",

  // O tema
  temaRotulo: "O tema · para que confiem em você",
  temaAjuda: "Passo a passo rende bem em carrossel: cada slide, um passo.",
  trocarTema: "Trocar o tema",
  escolherTema: "Escolha um tema",
  escreverTema: "Ou escreva o seu assunto",
  placeholderTema: "Por exemplo: três erros que estragam um sofá na hora de lavar",
  usarEsteTema: "Usar este tema",
  semTema: "Escolha um tema ou escreva o seu.",
  temasDeHoje: "Os temas de hoje",

  // Quantos slides
  quantos: "Quantos slides?",
  quantosAjuda: "5 para uma dica rápida, 7 para um passo a passo, 9 para um assunto com mais etapas.",

  // As fotos
  fotosTitulo: "As suas fotos",
  fotosAjuda: "O lugar, o seu trabalho, o resultado. De 1 a 9 fotos: a gente escolhe onde cada uma entra, e você troca depois.",
  mandarFotos: "Mandar fotos",
  fotoN: (n: number) => `foto ${n}`,
  tirarFoto: (n: number) => `Tirar a foto ${n}`,
  fotosAviso: "Só fotos suas, ou que você pode usar. A gente não cria imagem. Sem foto, o carrossel sai só com texto, na cor da sua marca.",
  fotoGrandeDemais: "Essa foto passa de 6 MB. Mande uma menor.",
  fotoNaoValida: "Mande fotos em jpg, png ou webp.",

  // Foto de paciente (marca de saúde)
  autorizacaoPaciente: "Tenho a autorização por escrito do paciente",
  autorizacaoPacienteAjuda: "Na saúde, foto de paciente só com o termo assinado por ele, como pede o conselho da sua profissão. O slide leva uma linha avisando isso.",
  autorizacaoPrecisa: "Marque que você tem a autorização do paciente para mandar a foto.",

  // Como vai sair
  comoSai: "Como vai sair",
  comoSaiAjuda: "A cor da sua marca e o seu @ em todos os slides. Nada do aplicativo aparece.",
  corDaMarca: "A cor da sua marca",
  corDaMarcaAjuda: "É a cor de todos os slides. Se for clara demais para ler, a gente escurece um pouco.",
  mudarCorOuArroba: "Mudar o @ na Conta",
  semArroba: "Sem @ ainda: coloque o seu Instagram na Conta.",
  trocarCor: "Trocar a cor",
  corTrocada: "Cor trocada",

  // Criar
  criar: "Criar o carrossel",
  criarAjuda: "Leva cerca de 1 minuto.",
  criando: "Criando...",

  // Gerando
  gerandoData: (n: number) => `Carrossel · ${n} slides`,
  gerandoTitulo: "Montando o seu carrossel",
  gerandoAjuda: "Leva cerca de 1 minuto. Fique nesta tela até ele ficar pronto.",
  etapaTexto: (n: number) => `Escrevendo o texto dos ${n} slides`,
  etapaConferindo: "Conferindo os dados e as fontes",
  etapaConferindoDica: "Número só entra com de onde veio e o ano.",
  etapaFotos: (fotos: number) => (fotos > 0 ? `Encaixando as suas ${fotos} ${fotos === 1 ? "foto" : "fotos"} e a cor da marca` : "Encaixando a cor da marca"),
  feito: ", feito",

  // Pronto
  prontoData: (n: number) => `Pronto · ${n} slides`,
  prontoTitulo: "O seu carrossel está pronto",
  prontoAjuda: "Arraste para ver todos. Toque num slide para trocar o texto ou a foto.",
  faixaAria: (n: number) => `Os ${n} slides`,
  slideAria: (n: number, total: number) => `Slide ${n} de ${total}`,
  slideDe: (n: number, total: number) => `Slide ${n} de ${total}`,
  nomeDoTipo: {
    "capa-foto": "capa com foto",
    "capa-texto": "capa",
    passo: "passo",
    item: "dica",
    "antes-depois": "antes e depois",
    dado: "dado",
    "prova-fala": "fala de cliente",
    "prova-resultado": "resultado",
    resumo: "resumo",
    chamada: "chamada final",
    noticia: "notícia",
  } as Record<string, string>,
  nomeCurtoDoTipo: { "capa-foto": "Capa", "capa-texto": "Capa", passo: "Passo", item: "Dica", "antes-depois": "Antes e depois", dado: "Dado", "prova-fala": "Fala", "prova-resultado": "Resultado", resumo: "Resumo", chamada: "Chamada", noticia: "Notícia" } as Record<string, string>,
  trocarTexto: "Trocar o texto",
  trocarFoto: "Trocar a foto",
  porFoto: "Pôr uma foto",
  precisaEncurtar: "O texto deste slide não coube. Toque em Trocar o texto e encurte.",
  precisaEncurtarAviso: (n: number) => (n === 1 ? "Um slide tem texto grande demais e precisa ser encurtado antes de postar." : `${n} slides têm texto grande demais e precisam ser encurtados antes de postar.`),
  precisaDeFoto: "Este slide precisa de uma foto. Toque em Pôr uma foto.",
  montandoPrevia: "Montando os slides",
  previaFalhou: "Não deu para montar os slides agora.",
  tentarDeNovo: "Tentar de novo",
  legendaRotulo: "A legenda",
  copiarLegenda: "Copiar a legenda",
  legendaCopiada: "Legenda copiada",
  paraPostar: "Para postar",
  baixar: (n: number) => `Baixar as ${n} imagens`,
  baixando: "Preparando as imagens...",
  baixarAjuda: (n: number) => `No celular, elas vão para a sua galeria, na ordem. No Instagram, escolha as ${n} de uma vez para postar como carrossel. A gente não posta nada sem você.`,
  baixarFalhou: "Não deu para baixar agora. Tente de novo em instantes.",
  fazerOutro: "Fazer outro com este tema",

  // Trocar o texto
  trocarTextoTitulo: (n: number) => `Trocar o texto do slide ${n}`,
  trocarTextoAjuda: (resumo: string) => `${resumo} O limite de palavras é o que cabe no slide sem a letra ficar pequena no celular.`,
  contagem: (usadas: number, limite: number) => `${usadas} de ${limite} palavras`,
  contagemCaracteres: (usados: number, limite: number) => `${usados} de ${limite} caracteres`,
  passou: (n: number) => `Passou ${n} ${n === 1 ? "palavra" : "palavras"}. Encurte para caber.`,
  passouCaracteres: (n: number) => `Passou ${n} caracteres. Encurte para caber.`,
  campoVazio: "Este campo não pode ficar vazio.",
  refazer: "Refazer este slide",
  refazendo: "Refazendo...",
  cancelar: "Cancelar",
  fechar: "Fechar",
  linhaN: (n: number) => `Linha ${n}`,
  acaoN: (n: number) => `Ação ${n}`,
  campos: {
    rotulo: "Etiqueta do alto",
    titulo: "Título",
    sub: "Frase de apoio",
    texto: "Explicação",
    antes: "Antes",
    depois: "Depois",
    valor: "Número",
    unidade: "Unidade",
    frase: "O que o número diz",
    fonte: "Quem publicou",
    referencia: "O que é e o ano",
    citacao: "A fala",
    quem: "Quem falou",
    contexto: "Contexto",
    veiculo: "Veículo",
    data: "Data",
  } as Record<string, string>,
  listas: { linhas: "Linhas do resumo", acoes: "Ações" } as Record<string, string>,
  falhouAoSalvar: "Não deu para salvar agora. Tente de novo.",

  // Trocar a foto
  trocarFotoTitulo: (n: number) => `Trocar a foto do slide ${n}`,
  trocarFotoAjuda: "Escolha uma das fotos que você mandou, ou mande outra. O texto do slide não muda.",
  nesteSlide: "Neste slide",
  fotoAria: (n: number, neste: boolean) => `Foto ${n}${neste ? ", neste slide" : ""}`,
  mandarOutraFoto: "Mandar outra foto",
  usarEstaFoto: "Usar esta foto",
  deixarSemFoto: "Deixar este slide sem foto",
  fotoDoAntes: "Foto do antes",
  fotoDoDepois: "Foto do depois",
  semFotosAinda: "Você ainda não mandou nenhuma foto.",

  // Erro
  erroRotulo: "Não deu certo",
  erroTitulo: "O carrossel não ficou pronto",
  erroAjuda: "Tivemos um problema ao montar os slides. As suas fotos e as suas escolhas continuam aqui.",

  // Limite (o teto do teste ou a assinatura)
  limiteTitulo: "Não dá para criar mais carrosséis agora",
  limiteAjuda: "Os carrosséis que você já fez continuam aqui para baixar.",
  verOpcoes: "Ver as opções",
  agoraNao: "Agora não",
} as const;
