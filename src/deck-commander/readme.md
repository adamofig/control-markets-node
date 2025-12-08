### How to use the DeckCommander

DeckCommander is just a scaffold to create a new entity in the database. Name DeckCommander will be renamed to the name you want.

1. get a project that use nest and install the library @dataclouder/nest-mongo

2. copy folder and add to the modules

### Entity T Framework

Just a fancy name i use to create a standard way for CRUD operations. and little more.

### Endpoints Provided in Entity T Framework

- GET /api/DeckCommander
- GET /api/DeckCommander/:id
- POST /api/DeckCommander
- PUT /api/DeckCommander/:id
- PATCH /api/DeckCommander/:id

- POST /api/DeckCommander/query
- PUT /api/DeckCommander/:id
- DELETE /api/DeckCommander/:id

### Update Strategy

There are 3 ways to update a DeckCommander entity

#### POST /api/DeckCommander/:id - Full Update

- POST /api/DeckCommander/:id This is the only one with double functionality, if id is not present it will create a new entity if id is present it will update the existing entity with the new information.

Advantage: is the easiest to use, update what you send, but frontend should take care of sending all the values all the time. Disadvantage: if you made a mistake sending values, you object will override and you lost the old values.

#### PUT /api/DeckCommander/:id - Partial Update Root Level

- PUT /api/DeckCommander/:id This is the second way to update a DeckCommander entity, it will update the existing entity with the new information, but ignoring nulls.

example: { "name": "test", "description": null, "captions": { "captions": { text: "some text" } } }

name and captions are the one you want to update, either you dont send the rest of the properties or theay are null or undefined, only if they have a value valid will be updated. and will update all the root level. means caption will be completed updated/override with this new value.

Advantage: you can update only the fields you want to update. Disadvantage: you need to send all the values all the time.

#### PATCH /api/DeckCommander/:id - Partial Update Granular Level

- PATCH /api/DeckCommander/:id This is the third way to update a DeckCommander entity, and the most granular, every property will be flattened, backend will build mongo special structure so you have to build your object at this granular level. example { "video.captions.remotion.captions": captions.captions } = { video: { captions: { remotion: { captions: captions } } } }

Advantage: generally i recomend this to don't affect other values and have the most control. Disadvantage: you need to send all the values all the time.

Note is not a arrayLevel, so you have to update all the array in future may be it will can do this data.array_data[1].value = {hola:1}
