import { config } from "@/lib/config";

/**
 * A prévia que o WhatsApp, o Instagram e o navegador mostram quando alguém cola um link do aplicativo (Open Graph, 27/11/2026, pedido do Gustavo para o convite do grupo de
 * clínicas). As imagens ficam em `public/marca/` (pasta que o middleware não protege, então quem busca a prévia não cai em `/entrar`), têm 1200x630 e menos de 300 KB (acima
 * disso o WhatsApp não mostra a imagem) e saem da identidade: fundo claro `#f7f7f5`, logotipo com a luz da marca, o destaque do título como marca-texto na luz, o rótulo em
 * verde-oliva `#3e5c00` e o cartão do roteiro do dia com a letra à mão (Caveat), no estilo da prévia do convite do OdontoTech que o Gustavo mostrou. O nome do produto está desenhado
 * nas imagens: se `APP_NAME` mudar, elas precisam ser geradas de novo.
 */
export const textosPreviaDeLink = {
  geral: {
    descricao: "Todo dia, o roteiro pronto para você gravar no celular. A gente descobre o que funciona no seu ramo e escreve o roteiro com a edição junto.",
    imagem: "/marca/previa.png",
    textoDaImagem: `${config.appName}: todo dia, o roteiro pronto para você gravar`,
  },
  convite: {
    titulo: `Um convite para você usar o ${config.appName}`,
    descricao: "Todo dia, o roteiro pronto para você gravar no celular. Crie o seu acesso e cadastre a sua empresa.",
    imagem: "/marca/previa-convite.png",
    textoDaImagem: `Convite para o ${config.appName}: você aparece, o resto é com a gente`,
  },
};

/** Largura e altura das imagens de prévia, as que o WhatsApp e o Facebook esperam. */
export const TAMANHO_DA_PREVIA = { width: 1200, height: 630 };
