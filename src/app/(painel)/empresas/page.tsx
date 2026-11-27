import { redirect } from "next/navigation";

import { SuasEmpresas } from "@/app/(painel)/(completo)/conta/GrupoDaConta";
import { QuemTemAcesso } from "@/app/(painel)/(completo)/conta/QuemTemAcesso";
import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario, membrosDaMarca } from "@/servicos/clientes";
import { ehDonoDeEmpresaDoGrupo, membrosParaODono, situacaoDasEmpresas } from "@/servicos/convite-de-grupo";
import { textosConviteDeGrupo } from "@/textos/convite-de-grupo";

import styles from "./page.module.css";

/**
 * "Suas empresas" e a equipe da empresa ativa, para quem criou o acesso por um convite de grupo. Fora do grupo `(completo)` de propósito, como `/assinar`: o dono precisa criar as outras
 * empresas e dar acesso à equipe ANTES de terminar o briefing de cada uma (a Conta, dentro do grupo, manda de volta ao briefing). Quem não é dono de grupo volta à Conta. No "ver como" o
 * admin só olha, então não há nada para mostrar aqui.
 */
export default async function Empresas() {
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  if (sessao.verComo) redirect("/conta");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));

  const situacao = await situacaoDasEmpresas(sessao.user.id);
  if (!situacao) redirect("/conta");
  const donoDaEmpresa = await ehDonoDeEmpresaDoGrupo(sessao.user.id, cliente.id);
  const membros = donoDaEmpresa ? membrosParaODono(await membrosDaMarca(cliente.id)) : [];

  return (
    <div className={styles.pagina}>
      <h1 className={styles.titulo}>{textosConviteDeGrupo.empresas.atalho}</h1>
      <SuasEmpresas usadas={situacao.usadas} maximo={situacao.maximo} />
      {donoDaEmpresa ? <QuemTemAcesso nomeMarca={cliente.nome} membros={membros} usuarioIdAtual={sessao.user.id} donoDoGrupo /> : null}
    </div>
  );
}
