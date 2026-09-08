#!/bin/sh
# Alinha ao CADASTRO a grafia do centro de custo dos lançamentos nascidos no Flow
# ("É O Amor" do cliente → "É o Amor" do cadastro). Só origem do Flow: conta_azul/ofx
# ficam como a fonte escreveu (mig. 250). Idempotente; lista antes e depois.
# Uso: ssh root@72.61.27.227 'sh -s' < /Users/rafaelgreiner/Repositorio-rgreiner/agency-workflow/scripts/alinhar-centros-cadastro.sh
