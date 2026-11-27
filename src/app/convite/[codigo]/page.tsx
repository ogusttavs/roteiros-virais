import Link from "next/link";
import { redirect } from "next/navigation";

import { CabecaDoCartao, CartaoDeConta, TelaDeConta } from "@/app/cadastro/pecas";
import styles from "@/app/cadastro/pecas.module.css";
import { destinoDaSessao } from "@/lib/destino-sem-marca";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { conviteValido } from "@/servicos/convite-de-grupo";
import { textosConviteDeGrupo } from "@/textos/convite-de-grupo";

import { FormularioDoConvite } from "./FormularioDoConvite";

/**
 * A página do link de convite de grupo. Pública (`middleware.ts`). Link que não vale (inexistente, usado, vencido ou desativado) mostra a mesma frase, sem formulário e sem dizer o motivo.
 * Quem já está com sessão vai ao painel, como em `/entrar`.
 */
export default async function ConviteDeGrupo({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const sessao = await sessaoAtual();
  if (sessao) redirect(destinoDaSessao(sessao.user.role, Boolean(await clienteAtivoDoUsuario(sessao.user.id))));

  const t = textosConviteDeGrupo;
  if (!(await conviteValido(codigo)).valido) {
    return (
      <TelaDeConta>
        <CartaoDeConta>
          <CabecaDoCartao titulo={t.linkInvalido.titulo} subtitulo={t.linkInvalido.texto} />
          <Link href="/entrar" className={styles.linkAcao}>
            {t.linkInvalido.entrar}
          </Link>
        </CartaoDeConta>
      </TelaDeConta>
    );
  }
  return <FormularioDoConvite codigo={codigo} textos={{ pagina: t.pagina, erros: t.erros }} />;
}
