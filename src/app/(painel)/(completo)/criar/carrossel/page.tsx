import { notFound, redirect } from "next/navigation";

import { carrosselAtivo } from "@/config/carrossel";
import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { exigirAssinaturaValida } from "@/lib/portao-cobranca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { arrobaDaMarca, marcaEhDeSaude } from "@/servicos/carrossel";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { temasParaCliente } from "@/servicos/temas";

import { CarrosselTela } from "./CarrosselTela";

/**
 * `/criar/carrossel` (E65 PR 2, desenho `entregaveis/design-v2/entrega/carrossel/CriarCarrossel.dc.html`): só existe com `CARROSSEL_ATIVO` ligada (desligada, a página não responde). Os temas do dia entram
 * como atalho; o resto é a tela `CarrosselTela`, que fala com as rotas `/api/carrossel`.
 */
export default async function CriarCarrossel() {
  if (!carrosselAtivo()) notFound();
  const sessao = await sessaoDoPainel();
  if (!sessao) redirect("/entrar");
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) redirect(destinoSemMarca(sessao.user.role));
  await exigirAssinaturaValida();
  const [temas, ramoSaude] = await Promise.all([temasParaCliente(cliente).catch(() => null), marcaEhDeSaude(cliente.id)]);
  const titulos = temas && temas.status === "ok" ? temas.temas.filter((t) => !t.doMomento).map((t) => t.titulo) : [];
  return <CarrosselTela temasDeHoje={titulos} corMarca={cliente.corMarca} arroba={arrobaDaMarca(cliente.perfis?.instagram)} ramoSaude={ramoSaude} />;
}
