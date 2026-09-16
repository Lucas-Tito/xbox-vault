"""Gravacao ATOMICA de JSON, para os coletores que salvam de tempos em tempos.

open(caminho, "w") trunca o arquivo ANTES de o conteudo novo existir: quem ler
naquele instante -- o bundle.py, ou o proprio coletor sendo retomado -- pega
JSON pela metade. Como os coletores salvam a cada 25 ou 100 itens, essa janela
de fracao de segundo se repete centenas de vezes numa coleta de horas, o que e
pouco para aparecer num teste e o bastante para acontecer de verdade.

Aqui a escrita vai para um temporario no MESMO diretorio (os.replace so e
atomico dentro do mesmo sistema de arquivos) e entra no lugar de uma vez: quem
le pega o arquivo antigo inteiro ou o novo inteiro, nunca um meio-termo.

Isto resolve JSON QUEBRADO, nao dado PARCIAL: o bundle.py lendo um dlc.json com
150 de 464 entradas continua sendo leitura legitima de uma coleta em andamento.

O piso anti-encolhimento e o .bak ficam no wikilib.save, que e para as listas
montadas de uma vez; aqui o coletor grava o que tem a cada volta, e recusar
menos itens que o arquivo atual quebraria justamente o uso com limite
(fetch_marketplace.py dlc 6, como se testa parser).
"""

import json
import os
import tempfile


def salvar(caminho, dados, indent=1, sort_keys=True, ensure_ascii=False):
    d = os.path.dirname(os.path.abspath(caminho))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(dados, f, ensure_ascii=ensure_ascii, indent=indent,
                      sort_keys=sort_keys)
            f.flush()
            os.fsync(f.fileno())      # o replace so vale se o conteudo ja esta em disco
        os.replace(tmp, caminho)
    except BaseException:             # inclui Ctrl+C no meio de uma coleta longa
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
