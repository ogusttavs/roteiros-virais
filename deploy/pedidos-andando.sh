# shellcheck shell=bash
# E74 PR 2a (R-n): deploy nao mata pedido. Antes de recriar o app e o worker, o deploy (e o ensaio) espera os pedidos de geracao em andamento (o roteiro e o carrossel que alguem esta
# esperando) terminarem, por ate ESPERA_DOS_PEDIDOS_S segundos (o mesmo numero de `ESPERA_DO_DEPLOY_S`, em src/config/pedidos.ts). Passado o prazo, o deploy segue: o pedido que parar no
# meio e fechado pela varredura (pronto com as versoes que ja sairam, ou falho sem contar no limite da pessoa).
#
# Este arquivo so define. Quem o usa define antes `contar_pedidos`, que imprime o numero de pedidos em andamento rodando "$SQL_PEDIDOS_ANDANDO" no Postgres certo (o deploy pela VPS, o
# ensaio pelo Compose local), e chama `esperar_pedidos`.

ESPERA_DOS_PEDIDOS_S=240
INTERVALO_DOS_PEDIDOS_S=${INTERVALO_DOS_PEDIDOS_S:-5}
# Os estados em andamento sao os de `ESTADOS_EM_ANDAMENTO` (src/config/pedidos.ts), na mesma ordem; `pedidos-andando.test.ts` confere.
SQL_PEDIDOS_ANDANDO="select count(*) from pedidos_de_geracao where estado in ('na_vez','lendo','escrevendo','conferindo')"

# esperar_pedidos [limite_s]: volta 0 sempre (nunca trava o deploy); diz na saida o que viu.
esperar_pedidos() {
  local limite=${1:-$ESPERA_DOS_PEDIDOS_S}
  local inicio agora n
  inicio=$(date +%s)
  while :; do
    n=$(contar_pedidos 2>/dev/null | tr -d '[:space:]') || n=""
    case "$n" in
      '' | *[!0-9]*)
        echo "nao deu para contar os pedidos em andamento; seguindo"
        return 0
        ;;
    esac
    if [ "$n" = "0" ]; then
      echo "nenhum pedido em andamento"
      return 0
    fi
    agora=$(date +%s)
    if [ $((agora - inicio)) -ge "$limite" ]; then
      echo "ainda ha $n pedido(s) em andamento depois de ${limite}s; seguindo (a varredura fecha o que parar no meio)"
      return 0
    fi
    echo "  $n pedido(s) em andamento; esperando terminar"
    sleep "$INTERVALO_DOS_PEDIDOS_S"
  done
}
