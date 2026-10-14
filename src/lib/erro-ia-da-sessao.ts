/**
 * A frase de um `ErroIA` para quem a tela vai mostrar (achado de 05/10/2026): o admin na SESSÃO REAL vê a causa (sem crédito, sobrecarga, chave recusada) e o cliente comum vê a frase
 * genérica de sempre. A sessão real, não a do "ver como": o admin que entra como a pessoa continua sendo o admin que precisa saber que a IA está sem crédito.
 */
import { ErroIA, fraseDoErroDaIA } from "@/ia/erro";
import { sessaoAtual } from "@/lib/sessao";

export async function fraseDoErroDaIAParaASessao(erro: ErroIA): Promise<string> {
  // Sem causa conhecida não há o que mostrar a mais: nem lê a sessão.
  if (!erro.causa) return erro.mensagemCliente;
  let souAdmin = false;
  try {
    souAdmin = (await sessaoAtual())?.user.role === "admin";
  } catch {
    // Sem sessão legível (fora de um pedido), a frase é a genérica.
  }
  return fraseDoErroDaIA(erro, souAdmin);
}
