import { Bookmark } from "lucide-react";
import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { referenciasDoNicho } from "@/servicos/pesquisa";
import { favoritosDoCliente } from "@/servicos/referencias";
import { textosReferencias } from "@/textos/referencias";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { ReferenciasTela } from "./ReferenciasTela";

export default async function Referencias() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  if (!cliente.nichoId) {
    return (
      <EstadoVazio icone={<Bookmark size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosReferencias.vazio} />
    );
  }

  const [videos, favoritos] = await Promise.all([
    referenciasDoNicho(cliente.nichoId),
    favoritosDoCliente(cliente.id),
  ]);

  if (videos.length === 0) {
    return (
      <EstadoVazio icone={<Bookmark size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosReferencias.vazio} />
    );
  }

  return <ReferenciasTela videos={videos} favoritosIniciais={[...favoritos]} />;
}
