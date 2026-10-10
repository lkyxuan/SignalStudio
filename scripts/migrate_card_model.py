"""Rehearse the additive migration on a consistent backup; never edit the source."""
import argparse
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'server'))
from card_model import CardModel, VERSION  # noqa: E402
from graph_service import GraphService  # noqa: E402


def rehearse(database):
    with tempfile.TemporaryDirectory(prefix='signalstudio-card-model-') as directory:
        copy_path=Path(directory)/'copy.db'
        with sqlite3.connect('file:'+str(database)+'?mode=ro',uri=True) as source,sqlite3.connect(copy_path) as target:
            source.backup(target)
        service=GraphService(copy_path)
        try:
            model=CardModel(service)
            before=model.legacy_checksum()
            first=model.migrate()
            assert first==model.migrate()
            assert model.legacy_checksum()==before
            assert service.db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
            assert not service.db.execute('PRAGMA foreign_key_check').fetchall()
            kinds={kind:count for kind,count in service.db.execute('SELECT kind,COUNT(*) FROM node_contracts GROUP BY kind')}
            readiness=model.readiness()
            with service.db:
                for table in ('graph_definition_reports','edge_bindings','node_ports','data_schemas','node_contracts'):
                    service.db.execute('DROP TABLE '+table)
                service.db.execute('DELETE FROM schema_meta WHERE key=?',(VERSION,))
            assert model.legacy_checksum()==before
            return {**first,'kinds':kinds,'repeat_safe':True,'rollback_rehearsal':True,
                    'integrity':'ok','foreign_keys':'ok','readiness':readiness,'source_modified':False}
        finally:
            service.db.close()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database',type=Path)
    parser.add_argument('--report',type=Path)
    args=parser.parse_args()
    if not args.database.is_file():
        parser.error('Existing database required')
    output=json.dumps(rehearse(args.database.resolve()),ensure_ascii=False,indent=2)+'\n'
    if args.report:
        args.report.write_text(output)
    print(output)


if __name__=='__main__':
    main()
