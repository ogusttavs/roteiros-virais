/**
 * Texto de tela de `/hoje/tema-livre` (brief-frontend.md, seção 6.4;
 * `entrega/textos.ts`, bloco `temaLivre`).
 */

export const textosTemaLivre = {
  titulo: "Sobre o que você quer falar?",
  placeholder: "por exemplo: como tirar cheiro de gordura da cozinha sem produto forte",
  ajuda: "um assunto, não um título de vídeo",
  campoVazio: "escreva um assunto antes de avaliar",
  avaliar: "avaliar o tema",
  esperando: "procurando vídeos sobre isso no seu setor",
  pilares: [
    "chance de viralizar",
    "chance de gerar cliente",
    "encaixe com você",
    "novidade",
    "facilidade de gravar",
  ],
  anguloTitulo: "o ângulo mais próximo que está funcionando",
  evidencia: (n: number) => `${n} vídeo${n === 1 ? "" : "s"} fora da curva nos últimos 90 dias`,
  usarAngulo: "usar esse ângulo",
  seguirMeu: "seguir com o meu tema mesmo assim",
  escrever: "escrever o roteiro",
  semEvidencia:
    "Não achamos vídeo fora da curva sobre isso no seu setor nos últimos 90 dias. O mais perto que está funcionando é o ângulo abaixo.",
  avaliarOutro: "avaliar outro tema",
  erro: "não conseguimos avaliar agora; o seu tema ficou salvo, tente de novo em um minuto",
};
