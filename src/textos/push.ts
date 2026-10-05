/**
 * O aviso de manhã por push (E48 PR 2): o texto da notificação e o pedido de permissão. O que a pessoa lê, em língua de gente.
 */
export const textosPush = {
  /** So para quem tem sessao de admin: o passo e o motivo, embaixo da frase de erro (item 0d). */
  motivoDoErro: (etapa: string, motivo: string) => `Para o admin: ${etapa}, ${motivo}`,
  /** A notificação do lembrete: com roteiro marcado na agenda do dia, ou só os temas. */
  roteiroPronto: "O seu roteiro de hoje está pronto",
  temasChegaram: "Os temas de hoje chegaram",
  /** A folha do pedido de permissão, na primeira abertura do aplicativo instalado. */
  pedido: {
    titulo: "Quer o aviso de manhã?",
    explica: "Quer o aviso de manhã quando o roteiro do dia estiver pronto? Chega no horário do seu lembrete, e um toque abre o dia.",
    quero: "Quero",
    agoraNao: "Agora não",
    ligando: "Ligando",
    erro: "Não deu para ligar o aviso agora. Tente de novo pela Conta.",
  },
  /** O cartão "Aviso de manhã" da Conta. */
  conta: {
    titulo: "Aviso de manhã",
    ligado: "Ligado neste aparelho. Chega no horário do lembrete.",
    desligado: "Desligado neste aparelho.",
    parou: "O aviso no celular parou de chegar. Ligue de novo, é só um toque.",
    semPermissao: "Este aparelho não deixa o aplicativo avisar. Nos ajustes do celular, procure o aplicativo e ligue as notificações.",
    precisaInstalar: "Para receber o aviso, instale o aplicativo na tela de início do celular e abra por ele.",
    semSuporte: "Este navegador não recebe avisos. No iPhone, instale o aplicativo na tela de início primeiro.",
    ligar: "Ligar o aviso",
    erro: "Não deu para mudar o aviso agora. Tente de novo em instantes.",
    desligar: "Desligar neste aparelho",
    horario: (hora: string) => `Horário do aviso: ${hora}. Você muda no campo de lembrete, logo abaixo.`,
  },
};
