"""게시판(boards) REST 라우터."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth import require_admin
from shared.database import get_db
from shared.models import User

from .. import crud, schemas

router = APIRouter(prefix="/api/v1/boards", tags=["boards"])


@router.get("", response_model=list[schemas.BoardOut])
async def read_boards(
    only_active: bool = Query(False, description="활성 게시판만 조회"),
    db: AsyncSession = Depends(get_db),
):
    return await crud.list_boards(db, only_active=only_active)


@router.post("", response_model=schemas.BoardOut, status_code=status.HTTP_201_CREATED)
async def create_board(
    payload: schemas.BoardCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    return await crud.create_board(db, payload)


@router.get("/{board_id}", response_model=schemas.BoardOut)
async def read_board(board_id: int, db: AsyncSession = Depends(get_db)):
    board = await crud.get_board(db, board_id)
    if board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시판을 찾을 수 없습니다.")
    return board


@router.put("/{board_id}", response_model=schemas.BoardOut)
async def update_board(
    board_id: int,
    payload: schemas.BoardUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    board = await crud.get_board(db, board_id)
    if board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시판을 찾을 수 없습니다.")
    return await crud.update_board(db, board, payload)


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_board(
    board_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    board = await crud.get_board(db, board_id)
    if board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "게시판을 찾을 수 없습니다.")
    await crud.delete_board(db, board)
