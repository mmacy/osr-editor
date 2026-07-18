// Friendly aliases over the generated types — type-checked, so a schema that
// vanishes from generation breaks loudly at tsc time. Never a hand-written
// mirror of a backend shape; the generated file is the single source.
import type { components } from './generated/api'

export type Adventure = components['schemas']['Adventure']
export type ApiError = components['schemas']['ApiError']
export type ApiErrorDetail = components['schemas']['ApiErrorDetail']
export type AreaSpec = components['schemas']['AreaSpec']
export type Diagnostics = components['schemas']['Diagnostics']
export type DoorSpec = components['schemas']['DoorSpec']
export type DungeonSpec = components['schemas']['DungeonSpec']
export type Edge = components['schemas']['Edge']
export type EditOp = components['schemas']['EditOp']
export type Finding = components['schemas']['Finding']
export type LevelSpec = components['schemas']['LevelSpec']
export type MonsterTemplate = components['schemas']['MonsterTemplate']
export type OpBatch = components['schemas']['OpBatch']
export type OpBatchResult = components['schemas']['OpBatchResult']
export type StatusResponse = components['schemas']['StatusResponse']
export type TownSpec = components['schemas']['TownSpec']
