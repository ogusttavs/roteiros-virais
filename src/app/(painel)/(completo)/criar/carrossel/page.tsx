import { notFound, redirect } from "next/navigation";

import { carrosselAtivo } from "@/config/carrossel";
import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { temasParaCliente } from "@/servicos/temas";

import { CarrosselTela } from "./CarrosselTela";

/**
 * `/criar/carrossel` (E65 PR 1, provisória): só existe com `CARROSSEL_ATIVO` ligada (desligada, a página não responde). Mostra os temas do dia como atalho e o formulário; o resto é a tela
 * `CarrosselTela`, que fala com as rotas `/api/carrossel`. O desenho final vem no PR 2.
 */
export default async function CriarCarrossel() {
  if (!carrosselAtivo()) notFound();
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));
  await exigirAssinaturaValida();
  const temas = await temasParaCliente(cliente).catch(() => null);
  const titulos = temas && temas.status === "ok" ? temas.temas.filter((t) => !t.doMomento).map((t) => t.titulo) : [];
  return <CarrosselTela temasDeHoje={titulos} corMarca={cliente.corMarca} />;
}
