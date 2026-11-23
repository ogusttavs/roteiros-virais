import { redirect } from "next/navigation";

import { CartaoDeConfirmacao } from "@/app/cadastro/CartaoDeConfirmacao";
import { CaminhoDoTeste, TelaDeConta } from "@/app/cadastro/pecas";
import { barreiraDoCadastroNaSessao } from "@/lib/portao-cadastro";
import { sessaoAtual } from "@/lib/sessao";
import { textosCadastro as t } from "@/textos/cadastro";

/**
 * "Confirme o seu e-mail" (E63 PR 2, o desenho de `CriarConta.dc.html`). É tudo o que o painel mostra a quem criou a conta sozinho e ainda não confirmou o e-mail. Quem não está
 * nessa situação (já confirmou, ou a conta é de convite) volta ao painel. O `?link=invalido` é o que o link vencido ou já usado traz: a mesma tela, na face "Esse link já venceu".
 * Sem sessão (o link foi aberto em outro aparelho) vai para `/entrar`.
 */
export default async function ConfirmarEmail({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  const barreira = await barreiraDoCadastroNaSessao();
  if (barreira?.tipo !== "email") redirect(sessao.user.role === "admin" ? "/admin" : "/hoje");

  return (
    <TelaDeConta comCaminho>
      <CartaoDeConfirmacao
        email={sessao.user.email}
        comecarEm={link === "invalido" ? "vencido" : "confirme"}
        textos={{ confirme: t.confirmeSeuEmail, trocar: t.trocarEmail, vencido: t.linkVencido }}
      />
      <CaminhoDoTeste passo={2} textos={t.caminho} />
    </TelaDeConta>
  );
}
