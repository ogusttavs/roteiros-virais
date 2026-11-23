import { FileText, History, CalendarDays } from "lucide-react";
import Link from "next/link";

import { CabecaDoCartao, CartaoDeConta, CaminhoDoTeste, TelaDeConta } from "@/app/cadastro/pecas";
import styles from "@/app/cadastro/pecas.module.css";
import { sessaoAtual } from "@/lib/sessao";
import { textosCadastro as t } from "@/textos/cadastro";

const ICONES = [FileText, History, CalendarDays];

/**
 * "E-mail confirmado" (E63 PR 2): para onde o link do e-mail leva (`/api/cadastro/confirmar`). Pública de propósito: a pessoa pode abrir o e-mail em outro aparelho, sem sessão; o
 * botão leva ao briefing e, sem sessão, o briefing passa por `/entrar`. O endereço só aparece quando há sessão (nunca vai na barra de endereço).
 */
export default async function EmailConfirmado() {
  const sessao = await sessaoAtual();
  const e = t.emailConfirmado;
  return (
    <TelaDeConta comCaminho>
      <CartaoDeConta>
        <CabecaDoCartao confirmado={sessao?.user.email} titulo={e.titulo} subtitulo={e.subtitulo} />
        <div className={styles.itensProximo}>
          {e.itens.map((texto, i) => {
            const Icone = ICONES[i];
            return (
              <div key={texto} className={styles.itemProximo}>
                <Icone aria-hidden="true" strokeWidth={1.5} />
                <p>{texto}</p>
              </div>
            );
          })}
        </div>
        <Link href="/comecar" className={styles.botaoLink}>
          {e.botao}
        </Link>
      </CartaoDeConta>
      <CaminhoDoTeste passo={3} textos={t.caminho} />
    </TelaDeConta>
  );
}
