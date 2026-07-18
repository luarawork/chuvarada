-- Seed de cidades foco (cobertura completa)
insert into cities (name, state, lat, lng, tide_code, data_level)
select * from (values
  ('Salvador', 'BA', -12.9714, -38.5014, '40140', 'full'),
  ('Recife', 'PE', -8.0476, -34.8770, '30645', 'full'),
  ('Natal', 'RN', -5.7945, -35.2110, '30461', 'full')
) as v(name, state, lat, lng, tide_code, data_level)
where not exists (select 1 from cities c where c.name = v.name and c.state = v.state);

-- Seed de cidades de cobertura parcial/mínima
insert into cities (name, state, lat, lng, tide_code, data_level)
select * from (values
  ('Fortaleza', 'CE', -3.7172, -38.5433, '30340', 'partial'),
  ('Maceió', 'AL', -9.6658, -35.7350, '30725', 'partial'),
  ('Aracaju', 'SE', -10.9472, -37.0731, '30825', 'partial'),
  ('João Pessoa', 'PB', -7.1195, -34.8450, '30540', 'partial'),
  ('São Luís', 'MA', -2.5297, -44.3028, '30120', 'minimal'),
  ('Teresina', 'PI', -5.0892, -42.8019, null, 'minimal')
) as v(name, state, lat, lng, tide_code, data_level)
where not exists (select 1 from cities c where c.name = v.name and c.state = v.state);
