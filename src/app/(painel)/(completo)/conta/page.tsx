import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario, membrosDaMarca, preferenciasDoUsuario } from "@/servicos/clientes";
import { textosConta } from "@/textos/conta";

import { BotaoSair } from "./BotaoSair";
import { FormularioConta } from "./FormularioConta";
import { InformacoesDoAparelho } from "./InformacoesDoAparelho";
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
      {/*
        V15, item 6b (design v2, passo 8): "Quem tem acesso a esta marca" é o lado fixo a partir
        de 1024px, começando no alto; os dados, os perfis, o lembrete, o tema e o pé (instalar,
        informações do aparelho, sair) ficam na coluna. Mesma posição no DOM de sempre: nada muda
        abaixo de 1024px.
      */}
      <div className={styles.colunaPrincipal}>
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
      </div>
      {cliente ? (
        <QuemTemAcesso nomeMarca={cliente.nome} membros={membros} usuarioIdAtual={sessao.user.id} />
      ) : null}
      <div className={styles.colunaPrincipal}>
        <InstalarNoCelular />
        <InformacoesDoAparelho versaoPainel={config.gitSha} />
        <BotaoSair />
      </div>
    </div>
  );
}
