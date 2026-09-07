from fastapi import FastAPI, UploadFile, File, HTTPException
import uvicorn
import shutil
import os
from mock_model import infer_spatiallm

app = FastAPI(title="SpatialLM 3D Prediction Engine", version="1.0.0")

@app.post("/api/v1/predict3d")
async def predict_3d(file: UploadFile = File(...)):
    if not file.filename.endswith('.ply'):
        raise HTTPException(status_code=400, detail="Only .ply files are supported")
    
    # Save uploaded file temporarily
    temp_file_path = f"/tmp/{file.filename}"
    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Call the inference logic
        result = infer_spatiallm(temp_file_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8002)
