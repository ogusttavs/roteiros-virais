import { config } from "@/lib/config";

/**
 * A casca dos dois e-mails (V5, item 7): cor, fonte de sistema e logotipo,
 * nunca o texto (isso continua em `email.ts` e `auth.ts`). E-mail não
 * carrega fonte própria, por isso a reserva de sistema aqui, nunca a Mona
 * Sans; e a maioria dos clientes de e-mail não confia em CSS externo nem em
 * `<svg>`, por isso tudo em estilo alinhado (inline) e o símbolo como PNG
 * (`favicon-48.png`, já em `public/`), não o SVG da marca. Cores fixas do
 * tema claro (`tokens.css`): e-mail não tem um jeito confiável de saber se
 * quem lê prefere escuro.
 */
const COR_FUNDO = "#f7f7f5";
const COR_CARTAO = "#ffffff";
const COR_TITULO = "#0c0c0e";
const COR_TEXTO = "#1e1e22";
const COR_BORDA = "rgba(15, 15, 20, 0.12)";
const FONTE_SISTEMA = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export function envolverEmail(corpoHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR_FUNDO};padding:32px 16px;font-family:${FONTE_SISTEMA};">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" style="max-width:420px;background:${COR_CARTAO};border:1px solid ${COR_BORDA};border-radius:24px;">
        <tr>
          <td style="padding:28px 24px 8px;">
            <img src="${config.appUrl}/favicon-48.png" width="32" height="32" alt="${config.appName}" style="display:block;border-radius:8px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px 28px;font-size:17px;line-height:1.5;color:${COR_TEXTO};">
            ${corpoHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/** O link do e-mail, na cor de ação do claro (preto), sempre sublinhado (e-mail não herda `--cor-acao`). */
export function linkEmail(url: string, texto: string): string {
  return `<a href="${url}" style="color:${COR_TITULO};font-weight:600;">${texto}</a>`;
}
