import { Video } from "lucide-react";
import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { videoSubindoParaAviso } from "@/servicos/curva";
import { corpoDoRoteiro, roteiroDeHoje } from "@/servicos/roteiro";
import { temasParaCliente } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { HojeCabecalho } from "./HojeCabecalho";
import { HojeTela } from "./HojeTela";
import styles from "./HojeTela.module.css";

const FORMATAR_DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });

function diaDaSemana(data: Date): string {
  return FORMATAR_DIA.format(data).replace("-feira", "");
}

function formatarVezes(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;
}

export default async function Hoje() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const [resultado, roteiroHoje, videoSubindo] = await Promise.all([
    temasParaCliente(cliente),
    roteiroDeHoje(cliente.id),
    videoSubindoParaAviso(cliente.id),
  ]);

  const avisoVideoSubindo = videoSubindo
    ? textosHoje.avisoVideoSubindo(diaDaSemana(videoSubindo.postadoEm), formatarVezes(videoSubindo.multiplicador))
    : null;

  if (resultado.status === "sem_tema") {
    return (
      <div className={styles.pagina}>
        <HojeCabecalho constancia={resultado.constancia} avisoVideoSubindo={avisoVideoSubindo} />
        <EstadoVazio
          icone={<Video size={24} strokeWidth={1.5} aria-hidden="true" />}
          frase={textosHoje.vazio}
        />
      </div>
    );
  }

  return (
    <HojeTela
      temas={resultado.temas}
      avisoLinhaEditorial={resultado.avisoLinhaEditorial}
      avisoVideoSubindo={avisoVideoSubindo}
      constancia={resultado.constancia}
      roteiroHoje={
        roteiroHoje
          ? {
              id: roteiroHoje.id,
              objetivo: roteiroHoje.objetivo,
              criadoEm: roteiroHoje.criadoEm,
              corpo: corpoDoRoteiro(roteiroHoje),
            }
          : null
      }
    />
  );
}
