from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from app.stations.repository import sqlite_repository


def test_concurrent_list_and_detail_reads_match_fixture(repo):
    sql = sqlite_repository()
    expected = {station.station_id: station for station in repo.list_all()}
    workers = 8
    start = Barrier(workers)

    def read(worker):
        start.wait(timeout=10)
        for iteration in range(40):
            if (worker + iteration) % 3 == 0:
                stations = sql.list_all()
                assert len(stations) == len(expected)
                assert {s.station_id: s for s in stations} == expected
            else:
                station_id = ('ST-04', 'ST-05')[(worker + iteration) % 2]
                assert sql.get(station_id) == expected[station_id]

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(read, range(workers)))
