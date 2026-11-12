-- Remove o deploy em nuvem (Railway/Render) e a infraestrutura OAuth/custom providers.
-- ProviderConnection, OAuthTransaction, CustomCompatibleProvider e CustomModel nunca tiveram
-- migration própria (podem ter sido criadas via `db push`), por isso o IF EXISTS.
DROP TABLE IF EXISTS "CloudDeployment";
DROP TABLE IF EXISTS "CloudConnection";
DROP TABLE IF EXISTS "CustomModel";
DROP TABLE IF EXISTS "CustomCompatibleProvider";
DROP TABLE IF EXISTS "OAuthTransaction";
DROP TABLE IF EXISTS "ProviderConnection";
