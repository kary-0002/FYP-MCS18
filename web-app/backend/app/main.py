from fastapi import FastAPI
from fastapi import UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Setting up CORS middleware -> allow requests from Vite (Port 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "localhost:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# API ENDPOINTS
@app.get("/")
async def get_home():
    return {"message": "Home Page"}

@app.post("/upload")
async def post_upload_veeg(veeg: UploadFile):
    # generate session ID
    # validate that it is unique
    # return -> redirect to get results by unique session ID
    return {"status": "veeg uploaded!"}


@app.get("/results/{session_id}")
async def get_results_by_id(session_id: str):
    return {"id": session_id}