import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario, membrosDaMarca, preferenciasDoUsuario } from "@/servicos/clientes";
import { textosConta } from "@/textos/conta";

import { BotaoSair } from "./BotaoSair";
import { FormularioConta } from "./FormularioConta";
import { InstalarNoCelular } from "./InstalarNoCelular";
import styles from "./page.module.css";
import { QuemTemAcesso } from "./QuemTemAcesso";

export default async function Conta() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const [cliente, preferencias] = await Promise.all([
    clienteAtivoDoUsuario(sessao.user.id),
    preferenciasDoUsuario(sessao.user.id),
  ]);
  const perfis = cliente?.perfis;
  const membros = cliente ? await membrosDaMarca(cliente.id) : [];

  return (
    <div className={styles.pagina}>
      <h1 className={styles.titulo}>{textosConta.titulo}</h1>
      <FormularioConta
        nomeInicial={sessao.user.name}
        email={sessao.user.email}
        instagramInicial={perfis?.instagram ?? ""}
        tiktokInicial={perfis?.tiktok ?? ""}
        youtubeInicial={perfis?.youtube ?? ""}
        temaInicial={cliente?.tema ?? "sistema"}
        horaLembreteInicial={preferencias?.horaLembrete ?? "08:00"}
        nomeMarca={cliente?.nome ?? ""}
      />
      {cliente ? (
        <QuemTemAcesso nomeMarca={cliente.nome} membros={membros} usuarioIdAtual={sessao.user.id} />
      ) : null}
      <InstalarNoCelular />
      <BotaoSair />
    </div>
  );
}
