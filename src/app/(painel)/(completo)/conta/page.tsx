import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { textosConta } from "@/textos/conta";

import { BotaoSair } from "./BotaoSair";
import { FormularioConta } from "./FormularioConta";
import styles from "./page.module.css";

export default async function Conta() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  const perfis = cliente?.perfis;

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
        horaLembreteInicial={cliente?.horaLembrete ?? "08:00"}
      />
      <BotaoSair />
    </div>
  );
}
