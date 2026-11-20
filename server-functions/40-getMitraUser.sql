-- tipo: SQL | Retorna ID e EMAIL do usuario Mitra logado (via :VAR_USER em INT_USER).
SELECT iu.ID AS ID, iu.DESCR AS EMAIL FROM INT_USER iu WHERE iu.ID = :VAR_USER