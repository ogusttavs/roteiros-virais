import { redirect } from "next/navigation";

import { CadastroFechado } from "@/app/cadastro/CadastroFechado";
import { FluxoCriarConta } from "@/app/cadastro/FluxoCriarConta";
import { textosDoFormularioDeInteressado } from "@/app/cadastro/formulario-interessado";
import { cadastroAberto } from "@/config/cadastro";
import { destinoDaSessao } from "@/lib/destino-sem-marca";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { textosCadastro as t } from "@/textos/cadastro";

/**
 * "Crie a sua conta" (E63 PR 2). Pública (`middleware.ts`). Quem já está com sessão vai ao painel, como em `/entrar`. Com a chave `CADASTRO_ABERTO` desligada a rota mostra o
 * cadastro fechado: o formulário de interessado de hoje.
 */
export default async function CriarConta() {
  const sessao = await sessaoAtual();
  if (sessao) redirect(destinoDaSessao(sessao.user.role, Boolean(await clienteAtivoDoUsuario(sessao.user.id))));

  if (!cadastroAberto()) return <CadastroFechado textos={t.cadastroFechado} formulario={textosDoFormularioDeInteressado()} />;

  return (
    <FluxoCriarConta
      textos={{ tela: t.criarConta, erros: t.erros, vazios: t.vazios, caminho: t.caminho, confirme: t.confirmeSeuEmail, trocar: t.trocarEmail, vencido: t.linkVencido }}
    />
  );
}
