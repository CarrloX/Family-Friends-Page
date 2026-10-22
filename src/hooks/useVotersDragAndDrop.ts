import { useState, useRef, useCallback } from 'react';
import type React from 'react';
import type { Voter } from '../types/voting';

export function useVotersDragAndDrop(
  setVoters: React.Dispatch<React.SetStateAction<Voter[]>>,
  isMobile: boolean,
  disabled = false
) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const draggedIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    draggedIndexRef.current = index;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  }, [disabled]);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    if (disabled) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex((prev) => (prev !== index ? index : prev));
  }, [disabled]);

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (disabled) {
      draggedIndexRef.current = null;
      setDragOverIndex(null);
      setDraggedIndex(null);
      return;
    }

    const dataIndexStr = e.dataTransfer.getData('text/plain');
    const parsedDataIndex = dataIndexStr !== '' ? Number.parseInt(dataIndexStr, 10) : null;
    const sourceIndex = draggedIndexRef.current ?? (parsedDataIndex !== null && !Number.isNaN(parsedDataIndex) ? parsedDataIndex : null);

    draggedIndexRef.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);

    if (sourceIndex === null || sourceIndex === targetIndex) {
      return;
    }

    setVoters((prevVoters) => {
      if (sourceIndex < 0 || sourceIndex >= prevVoters.length || targetIndex < 0 || targetIndex >= prevVoters.length) {
        return prevVoters;
      }
      const updated = [...prevVoters];
      const [draggedItem] = updated.splice(sourceIndex, 1);
      updated.splice(targetIndex, 0, draggedItem);
      return updated;
    });
  }, [setVoters, disabled]);

  const handleDragEnd = useCallback(() => {
    draggedIndexRef.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const getDragProps = useCallback((index: number) => {
    if (isMobile || disabled) {
      return { draggable: false, isDragging: false, isDragOver: false };
    }
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => handleDragStart(e, index),
      onDragOver: (e: React.DragEvent) => handleDragOver(e, index),
      onDrop: (e: React.DragEvent) => handleDrop(e, index),
      onDragEnd: handleDragEnd,
      isDragging: draggedIndex === index,
      isDragOver: dragOverIndex === index,
    };
  }, [isMobile, disabled, handleDragStart, handleDragOver, handleDrop, handleDragEnd, draggedIndex, dragOverIndex]);

  return { getDragProps };
}

export default useVotersDragAndDrop;
