-- Registra de onde veio o nome de cada bairro (bairro/distrito/subdistrito/setor),
-- pra distinguir no front-end um bairro urbano de verdade de um distrito
-- administrativo inteiro usado como fallback (municípios pequenos do
-- interior sem NM_BAIRRO no Censo 2022). Sem esse campo não dá pra saber,
-- só olhando o texto do nome, se "São Luís" ou "Ipitanga" é um bairro real
-- ou o distrito-sede inteiro do município.
alter table neighborhoods add column if not exists name_source text
  check (name_source in ('bairro', 'subdistrito', 'distrito', 'setor'));
