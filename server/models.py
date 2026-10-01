"""
Data models — strict Pydantic validation on all input.
"""
import re
from pydantic import BaseModel, Field, field_validator

BASE62_PATTERN = re.compile(r'^[0-9A-Za-z.\-]*$')


class ScanPayload(BaseModel):
    """Incoming scan from the Tampermonkey script."""
    city_id: int = Field(gt=0)
    world_id: int = Field(ge=1, le=999)
    x: int = Field(ge=0, le=1600)
    y: int = Field(ge=0, le=1600)
    name: str = Field(max_length=50)
    owner: str = Field(max_length=50)
    owner_id: int = Field()
    alliance: str = Field(max_length=50, default="")
    alliance_id: int = Field(ge=0, default=0)
    faction: int = Field(ge=0, le=10)
    level_base: float = Field(ge=0, le=100)
    level_off: float = Field(ge=0, le=100)
    level_def: float = Field(ge=0, le=100)
    tiles: str = Field(max_length=500)
    buildings: str = Field(max_length=2000, default="")
    defense_units: str = Field(max_length=2000, default="")
    offense_units: str = Field(max_length=2000, default="")
    upgrades: dict[str, int] = Field(default_factory=dict)
    scanned_by: str = Field(max_length=50)
    version: int = Field(gt=0)
    timestamp: int = Field(gt=0)

    @field_validator('name', 'owner', 'alliance', 'scanned_by')
    @classmethod
    def strip_strings(cls, v: str) -> str:
        return v.strip()

    @field_validator('tiles', 'buildings', 'defense_units', 'offense_units')
    @classmethod
    def validate_encoded_fields(cls, v: str) -> str:
        if v and not BASE62_PATTERN.match(v):
            raise ValueError('Field contains invalid characters')
        return v

    @field_validator('upgrades')
    @classmethod
    def validate_upgrades(cls, v: dict) -> dict:
        if len(v) > 50:
            raise ValueError('Too many upgrade entries')
        for key, val in v.items():
            if not isinstance(val, int) or val < 0 or val > 20:
                raise ValueError(f'Invalid upgrade value for {key}')
        return v


class ScanResponse(BaseModel):
    status: str
    city_id: int
