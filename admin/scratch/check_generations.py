import pymongo
import json
from bson import ObjectId

class JSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ObjectId):
            return str(o)
        return json.JSONEncoder.default(self, o)

client = pymongo.MongoClient('mongodb://localhost:27017/smart-floor-planner')
db = client['smart-floor-planner']
gen = list(db['aigenerations'].find().sort('createdAt', -1).limit(5))
print(json.dumps(gen, cls=JSONEncoder, indent=2, ensure_ascii=False))
