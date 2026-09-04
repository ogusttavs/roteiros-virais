import { Video } from "lucide-react";
import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { temasParaCliente } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { HojeTela } from "./HojeTela";

export default async function Hoje() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const resultado = await temasParaCliente(cliente);

  if (resultado.status === "sem_tema") {
    return <EstadoVazio icone={<Video size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosHoje.vazio} />;
  }

  return (
    <HojeTela
      temas={resultado.temas}
      avisoLinhaEditorial={resultado.avisoLinhaEditorial}
      constancia={resultado.constancia}
    />
  );
}
