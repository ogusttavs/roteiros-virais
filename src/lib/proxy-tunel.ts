import { config } from "@/lib/config";

/**
 * O proxy do YouTube é, provisoriamente (23/10/2026), um túnel SOCKS reverso aberto pelo computador do Gustavo
 * (`socks5://172.19.0.1:1080`, o endereço do computador visto de dentro do Docker). Os avisos do admin mudam de texto nesse
 * caso, porque "proxy fora do ar" quer dizer computador desligado e não fornecedor fora do ar. Só devolve se é o túnel:
 * o endereço e a credencial nunca saem daqui.
 */
export function proxyEhTunel(endereco: string | undefined = config.transcricao.ytdlpProxy): boolean {
  return typeof endereco === "string" && endereco.trim().toLowerCase().startsWith("socks5://172.");
}
