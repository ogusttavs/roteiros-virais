/**
 * Texto de tela de `/hoje` (brief-frontend.md, seção 6.3;
 * `entrega/textos.ts`, bloco `hoje`), incluindo o cartão de roteiro do dia
 * (etapa 11, `HojeCelular.dc.html`, quadro "roteiro").
 *
 * O rótulo por objetivo do `TemaCartao` ("para te conhecerem") fica em
 * `src/ia/enums.ts`, não aqui: a chave do objeto seria um dos três nomes
 * internos do objetivo (escopo-e-arquitetura.md 4.3), que coincidem com o
 * jargão proibido em `regras-de-texto.ts`; o `checar-texto` reprovaria o
 * identificador mesmo sem virar texto de tela (mesmo motivo de
 * `NOME_OBJETIVO` já estar lá).
 */

export const textosHoje = {
  titulo: "O que gravar hoje",
  constancia: {
    seguidos: (n: number) => `${n} dia${n === 1 ? "" : "s"} seguido${n === 1 ? "" : "s"} gravando`,
    parado: (n: number) => `faz ${n} dia${n === 1 ? "" : "s"} que você não grava`,
    primeiroDia: "hoje é o seu primeiro dia",
  },
  evidencia: (n: number) => `${n} vídeo${n === 1 ? "" : "s"} fora da curva esta semana`,
  queroEsse: "quero esse",
  outraCoisa: "quero falar de outra coisa",
  carregando: "lendo os vídeos que funcionaram esta semana",
  vazio:
    "Ainda estamos lendo o que funciona no seu setor. Os temas de hoje aparecem aqui amanhã cedo.",
  erro: "não conseguimos buscar os temas agora; tente de novo em um minuto",
  tentarDeNovo: "tentar de novo",
  roteiroDeHoje: "Roteiro de hoje",
  escritoAs: (h: string) => `escrito às ${h}`,
  abrirRoteiro: "abrir roteiro",
  verOutros: "ver outros temas de hoje",
  esconderOutros: "esconder os outros temas",
  trocar: "trocar",
};
