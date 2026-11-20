-- tipo: SQL | Persiste a ordem de um modelo/driver. Params: driverId, ordem.
UPDATE DRIVERS SET ORDEM = {{ordem}} WHERE ID = {{driverId}}